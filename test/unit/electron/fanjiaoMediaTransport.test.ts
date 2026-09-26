import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 代理仅作用于饭角媒体；环境覆盖本机文件，不打印带认证信息的配置或错误。
const mocks = vi.hoisted(() => ({ read: vi.fn(), nativeFetch: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: mocks.read }));
vi.mock('../../../electron/fanjiao/chromiumMediaFetch.mjs', () => ({ fetchChromiumMedia: mocks.nativeFetch }));
import { createMediaTransport, readMediaProxy } from '../../../electron/fanjiao/mediaTransport.mjs';
import { readMediaAsset } from '../../../electron/fanjiao/session.mjs';

const locations = { appPath: '/app', userData: '/profile', isDev: true, env: {} };
beforeEach(() => { mocks.read.mockReset(); mocks.nativeFetch.mockReset().mockImplementation(async (_net, session, url, options) => session.fetch(String(url), options)); });
afterEach(() => vi.unstubAllGlobals());
function sessionsFixture() {
    const makeSession = () => ({ fetch: vi.fn(async (_url: string, _options?: RequestInit) => new Response('media')),
        setProxy: vi.fn(async (_config: unknown) => {}), closeAllConnections: vi.fn(async () => {}) });
    const defaultSession = makeSession(), dedicated = makeSession();
    return { defaultSession, dedicated, fromPartition: vi.fn(() => dedicated) };
}
describe('Fanjiao media proxy', () => {
    it('reads the local config with environment override and an explicit direct option', () => {
        mocks.read.mockReturnValue(' http://127.0.0.1:7897\n');
        expect(readMediaProxy(locations)).toBe('http://127.0.0.1:7897/');
        expect(mocks.read.mock.calls[0][0].replaceAll('\\', '/')).toBe('/app/.fanjiao.proxy.local');
        readMediaProxy({ ...locations, isDev: false });
        expect(mocks.read.mock.calls[1][0].replaceAll('\\', '/')).toBe('/profile/.fanjiao.proxy.local');
        mocks.read.mockClear();
        expect(readMediaProxy({ ...locations, env: { FANJIAO_MEDIA_PROXY: 'direct' } })).toBe('direct');
        expect(mocks.read).not.toHaveBeenCalled();
        mocks.read.mockImplementation(() => { throw new Error('Missing'); });
        expect(readMediaProxy(locations)).toBe('system');
        expect(readMediaProxy({ ...locations, env: { FANJIAO_MEDIA_PROXY: 'system' } })).toBe('system');
    });
    it('rejects invalid proxy configuration without exposing it', () => {
        for (const value of ['socks://user:private@localhost:1', 'http://user:private@localhost:1', 'http://localhost/path', 'http://localhost/?private=value', 'invalid-private-value']) {
            expect(() => readMediaProxy({ ...locations, env: { FANJIAO_MEDIA_PROXY: value } }))
                .toThrow('Invalid Fanjiao media proxy configuration');
        }
    });
    it('uses Chromium with the private proxy and preserves URL, cancellation and redirect boundaries', async () => {
        const nodeFetch = vi.fn(); vi.stubGlobal('fetch', nodeFetch);
        const sessions = sessionsFixture();
        const transport = await createMediaTransport('http://127.0.0.1:7897/', sessions, {});
        expect(sessions.dedicated.setProxy).toHaveBeenCalledWith({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7897' });
        const controller = new AbortController();
        await expect(readMediaAsset('https://play.fanjiao.co/0.ts', controller.signal, 100, transport.fetch))
            .resolves.toEqual(Buffer.from('media'));
        expect(nodeFetch).not.toHaveBeenCalled();
        expect(sessions.dedicated.fetch.mock.calls[0][0]).toBe('https://play.fanjiao.co/0.ts');
        expect(sessions.dedicated.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
        controller.abort();
        expect(sessions.dedicated.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
        await expect(readMediaAsset('https://foreign.invalid/0.ts', undefined, 100, transport.fetch)).rejects.toThrow('host');
        expect(sessions.dedicated.fetch).toHaveBeenCalledOnce();
        transport.dispose();
        expect(sessions.dedicated.closeAllConnections).toHaveBeenCalledOnce();
        expect(sessions.defaultSession.setProxy).not.toHaveBeenCalled();
    });
    it('shares the player session by default and disposes only its own requests', async () => {
        const sessions = sessionsFixture();
        const transport = await createMediaTransport('system', sessions, {});
        await transport.fetch('https://play.fanjiao.co/0.ts', { redirect: 'error' });
        expect(sessions.defaultSession.fetch).toHaveBeenCalledOnce();
        expect(sessions.fromPartition).not.toHaveBeenCalled();
        expect(sessions.defaultSession.setProxy).not.toHaveBeenCalled();
        transport.dispose();
        expect(sessions.defaultSession.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(sessions.defaultSession.closeAllConnections).not.toHaveBeenCalled();
        await expect(transport.fetch('https://play.fanjiao.co/0.ts')).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('supports explicit direct mode without disabling proxy use for other music', async () => {
        const sessions = sessionsFixture();
        const transport = await createMediaTransport('direct', sessions, {});
        expect(sessions.dedicated.setProxy).toHaveBeenCalledWith({ mode: 'direct' });
        expect(sessions.defaultSession.setProxy).not.toHaveBeenCalled();
        transport.dispose();
    });
    it('does not silently fall back to Node when Chromium proxy setup fails', async () => {
        const sessions = sessionsFixture();
        sessions.dedicated.setProxy.mockRejectedValue(new Error('Unavailable'));
        await expect(createMediaTransport('direct', sessions, {})).rejects.toThrow('Unavailable');
    });
});
