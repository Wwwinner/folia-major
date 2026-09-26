import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fetchChromiumMedia } from './chromiumMediaFetch.mjs';

// 饭角上游媒体由 Chromium 下载；默认共用播放器会话，显式代理覆盖仅作用于独立媒体会话。
export function readMediaProxy({ appPath, userData, isDev, env = process.env }) {
    let value = env.FANJIAO_MEDIA_PROXY;
    if (value === undefined) {
        try { value = readFileSync(path.join(isDev ? appPath : userData, '.fanjiao.proxy.local'), 'utf8'); }
        catch { value = ''; }
    }
    value = value.trim();
    if (!value || value === 'system') return 'system';
    if (value === 'direct') return 'direct';
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
            || url.search || url.hash || url.pathname !== '/') throw new Error();
        return url.href;
    } catch { throw new Error('Invalid Fanjiao media proxy configuration'); }
}

export async function createMediaTransport(proxy, sessions, net) {
    const dedicated = !!proxy && proxy !== 'system';
    const mediaSession = dedicated ? sessions.fromPartition('folia-fanjiao-media') : sessions.defaultSession;
    if (dedicated) await mediaSession.setProxy(proxy === 'direct' ? { mode: 'direct' }
        : { mode: 'fixed_servers', proxyRules: new URL(proxy).origin });
    const lifetime = new AbortController();
    return {
        fetch: async (url, options = {}) => {
            lifetime.signal.throwIfAborted();
            return fetchChromiumMedia(net, mediaSession, url, { ...options,
                signal: options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal });
        },
        dispose: () => {
            if (lifetime.signal.aborted) return;
            lifetime.abort();
            if (dedicated) void mediaSession.closeAllConnections().catch(() => {});
        },
    };
}
