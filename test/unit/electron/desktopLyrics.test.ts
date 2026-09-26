import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_LYRICS_APPEARANCE } from '../../../src/types/desktopLyrics';

// 原生窗口使用可观测替身，验证 IPC 权限、主窗口隔离、位置与锁定持久化。
const require = createRequire(import.meta.url);
const { createDesktopLyricsController } = require('../../../electron/desktopLyricsWindow.cjs');
const { resolveDesktopLyricsBounds, normalizeDesktopLyricsState, DEFAULT_APPEARANCE } = require('../../../electron/desktopLyricsModel.cjs');
class WindowStub extends EventEmitter {
    static created: WindowStub[] = [];
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn(), mainFrame: {} });
    destroyed = false;
    bounds: any;
    setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setIgnoreMouseEvents = vi.fn();
    setFocusable = vi.fn(); setResizable = vi.fn(); showInactive = vi.fn();
    loadURL = vi.fn(async () => {}); loadFile = vi.fn(async () => {});
    constructor(public options: any) { super(); this.bounds = options; WindowStub.created.push(this); }
    getBounds() { return this.bounds; }
    setBounds(bounds: any) { this.bounds = bounds; this.emit('resize'); }
    isDestroyed() { return this.destroyed; }
    close() { this.emit('close'); this.destroy(); }
    destroy() { this.destroyed = true; this.emit('closed'); }
}
const area = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
function fixture(saved: Record<string, any> = {}) {
    const main = new WindowStub({ width: 1100, height: 800 });
    WindowStub.created = [];
    const values = new Map(Object.entries(saved));
    const handlers = new Map<string, (...args: any[]) => any>();
    const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => [area], getPrimaryDisplay: () => area });
    let snapshot: any = { trackKey: 'episode:1', hasTrack: true, currentTime: 13, duration: 30,
        playerState: 'playing', playbackRate: 2, isAdvancing: true, updatedAt: 1, lyrics: { lines: [] }, coverUrl: 'private-cover', audioSrc: 'private-audio' };
    const controller = createDesktopLyricsController({ BrowserWindow: WindowStub, screen,
        ipcMain: { handle: (key: string, cb: any) => handlers.set(key, cb), removeHandler: (key: string) => handlers.delete(key) },
        store: { get: (key: string) => values.get(key), set: (key: string, value: any) => values.set(key, value) },
        getMainWindow: () => main, getSnapshot: () => snapshot, isDev: true, onChange: vi.fn() });
    return { main, controller, values, handlers, screen, setSnapshot: (value: any) => { snapshot = value; },
        invoke: (channel: string, patch?: any, sender = main.webContents, frame = sender.mainFrame) => handlers.get(channel)!({ sender, senderFrame: frame }, patch) };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('independent desktop lyrics window', () => {
    it('opens only one transparent companion and never changes main-window presentation', () => {
        const { main, controller, invoke } = fixture();
        invoke('desktop-lyrics-update', { enabled: true });
        invoke('desktop-lyrics-update', { enabled: true });
        expect(WindowStub.created).toHaveLength(1);
        const win = WindowStub.created[0];
        expect(win.options).toMatchObject({ frame: false, transparent: true, skipTaskbar: true,
            webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
        expect(main.setAlwaysOnTop).not.toHaveBeenCalled();
        expect(main.setIgnoreMouseEvents).not.toHaveBeenCalled();
        expect(main.getBounds()).toEqual({ width: 1100, height: 800 });
        controller.dispose();
    });
    it('rejects other windows, subframes and unknown settings', () => {
        const { controller, invoke, main } = fixture();
        expect(() => invoke('desktop-lyrics-update', { enabled: true }, new WindowStub({}).webContents)).toThrow('Untrusted');
        expect(() => invoke('desktop-lyrics-update', { enabled: true }, main.webContents, {})).toThrow('Untrusted');
        expect(() => invoke('desktop-lyrics-update', { url: 'https://example.com' })).toThrow('Unknown');
        expect(() => invoke('desktop-lyrics-update', { fontSize: NaN })).toThrow('Invalid');
        controller.dispose();
    });
    it('closes synchronously and can immediately reopen without reviving a closing window', () => {
        const { controller, invoke, values } = fixture();
        invoke('desktop-lyrics-update', { enabled: true });
        const first = WindowStub.created[0];
        first.close = vi.fn(); // Electron close() may wait for the renderer unload event.
        first.setBounds({ x: 20, y: 30, width: 600, height: 250 });
        expect(invoke('desktop-lyrics-update', { enabled: false }).enabled).toBe(false);
        expect(first.isDestroyed()).toBe(true);
        expect(values.get('DESKTOP_LYRICS_BOUNDS')).toEqual({ x: 20, y: 30, width: 600, height: 250 });
        expect(invoke('desktop-lyrics-update', { enabled: true }).enabled).toBe(true);
        expect(WindowStub.created).toHaveLength(2);
        controller.dispose();
    });
    it('remembers lock, appearance and window bounds across shutdown without changing enabled intent', () => {
        vi.useFakeTimers();
        const { controller, invoke, values } = fixture();
        invoke('desktop-lyrics-update', { enabled: true, fontSize: 44, glowIntensity: 0 });
        const win = WindowStub.created[0];
        invoke('desktop-lyrics-update', { locked: true }, win.webContents);
        expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
        expect(win.setResizable).toHaveBeenLastCalledWith(false);
        win.setBounds({ x: 100, y: 200, width: 600, height: 260 });
        vi.advanceTimersByTime(250);
        controller.dispose(); controller.close();
        expect(values.get('DESKTOP_LYRICS')).toEqual({ enabled: true, locked: true, fontSize: 44, glowIntensity: 0 });
        expect(values.get('DESKTOP_LYRICS_BOUNDS')).toEqual({ x: 100, y: 200, width: 600, height: 260 });
        const restored = fixture(Object.fromEntries(values));
        restored.controller.restore();
        expect(WindowStub.created[0].getBounds()).toMatchObject({ x: 100, y: 200, width: 600, height: 260 });
        restored.controller.dispose();
    });
    it('publishes only caption data and omits unchanged lyrics from clock packets', () => {
        const { controller, invoke } = fixture();
        invoke('desktop-lyrics-update', { enabled: true });
        const win = WindowStub.created[0];
        const snapshot = { trackKey: 'a', lyrics: { lines: [] }, currentTime: 12, coverUrl: 'private-cover', audioSrc: 'private-audio' };
        controller.publish(snapshot);
        expect(win.webContents.send.mock.calls.at(-1)?.[1]).toHaveProperty('lyrics');
        controller.publish({ ...snapshot, currentTime: 13 });
        expect(win.webContents.send.mock.calls.at(-1)?.[1]).not.toHaveProperty('lyrics');
        expect(JSON.stringify(win.webContents.send.mock.calls)).not.toContain('private-');
        controller.dispose();
    });
    it('repairs offscreen and oversized bounds while preserving a connected negative-coordinate monitor', () => {
        const second = { workArea: { x: -1280, y: 0, width: 1280, height: 720 } };
        expect(resolveDesktopLyricsBounds({ x: -1000, y: 100, width: 600, height: 240 }, [area, second], area))
            .toEqual({ x: -1000, y: 100, width: 600, height: 240 });
        const small = { workArea: { x: 0, y: 0, width: 390, height: 300 } };
        expect(resolveDesktopLyricsBounds(null, [small], small)).toEqual({ x: 0, y: 0, width: 390, height: 240 });
        expect(resolveDesktopLyricsBounds({ x: 9999, y: 9999, width: 5000, height: 5000 }, [area], area))
            .toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
        expect(DEFAULT_APPEARANCE).toEqual(DEFAULT_DESKTOP_LYRICS_APPEARANCE);
        expect(normalizeDesktopLyricsState(null)).toEqual({ ...DEFAULT_APPEARANCE, enabled: false, locked: false });
    });
});
