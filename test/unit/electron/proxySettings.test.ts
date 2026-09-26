import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeProxySettings, loadProxySettings, toChromiumProxyConfig } from '../../../electron/proxySettings.cjs';

// 只验证代理设置与一次性迁移，不触碰本机设置、网络或已有账号凭据。
const locations = { appPath: '/app', userData: '/profile', isDev: true, env: {} };
function store(value?: unknown) {
    let saved = value;
    return { get: vi.fn(() => saved), set: vi.fn((_key: string, next: unknown) => { saved = next; }) };
}
const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.unlinkSync(path.join(directory, '.fanjiao.proxy.local'));
        fs.rmdirSync(directory);
    }
});
describe('desktop proxy settings', () => {
    it.each([
        ['127.0.0.1:7897', 'http://127.0.0.1:7897'],
        ['https://proxy.example:443/', 'https://proxy.example'],
        ['socks5://[::1]:7898', 'socks5://[::1]:7898'],
    ])('normalizes %s and builds Chromium rules', (input, expected) => {
        const settings = normalizeProxySettings({ mode: 'custom', address: input });
        expect(settings).toEqual({ mode: 'custom', address: expected });
        expect(toChromiumProxyConfig(settings)).toEqual({ mode: 'fixed_servers', proxyRules: expected });
    });
    it.each(['', 'http://user:secret@host:7897', 'file:///tmp/proxy', 'http://host/path', 'http://host?url=other', 'http://host:70000', 'http://host:0', 'host name:80'])('rejects invalid custom addresses: %s', address => {
        expect(() => normalizeProxySettings({ mode: 'custom', address })).toThrow('INVALID_PROXY_SETTINGS');
    });
    it('never lets stale custom rules override system or direct mode', () => {
        for (const mode of ['system', 'direct']) {
            expect(normalizeProxySettings({ mode, address: 'stale' })).toEqual({ mode, address: '' });
            expect(toChromiumProxyConfig({ mode, address: 'stale' })).toEqual({ mode });
        }
    });
    it('migrates legacy configuration once, then respects saved user settings', () => {
        const settings = store();
        const env = { FANJIAO_MEDIA_PROXY: 'http://127.0.0.1:7897' };
        expect(loadProxySettings(settings, { ...locations, env })).toEqual({ mode: 'custom', address: env.FANJIAO_MEDIA_PROXY });
        settings.set('NETWORK_PROXY', { mode: 'direct', address: '' });
        expect(loadProxySettings(settings, { ...locations, env })).toEqual({ mode: 'direct', address: '' });
    });
    it('defaults to the system for new profiles and invalid persisted data', () => {
        expect(loadProxySettings(store(), locations)).toEqual({ mode: 'system', address: '' });
        expect(loadProxySettings(store({ mode: 'bad' }), locations)).toEqual({ mode: 'system', address: '' });
    });
    it('migrates the local file without letting later edits override the app setting', () => {
        fs.mkdirSync(path.join(process.cwd(), 'test-results'), { recursive: true });
        const directory = fs.mkdtempSync(path.join(process.cwd(), 'test-results/proxy-settings-unit-'));
        temporaryDirectories.push(directory);
        fs.writeFileSync(path.join(directory, '.fanjiao.proxy.local'), 'http://127.0.0.1:7897');
        const settings = store();
        const options = { ...locations, appPath: directory };
        expect(loadProxySettings(settings, options)).toEqual({ mode: 'custom', address: 'http://127.0.0.1:7897' });
        settings.set('NETWORK_PROXY', { mode: 'system', address: '' });
        fs.writeFileSync(path.join(directory, '.fanjiao.proxy.local'), 'http://127.0.0.1:9999');
        expect(loadProxySettings(settings, options)).toEqual({ mode: 'system', address: '' });
    });
});
