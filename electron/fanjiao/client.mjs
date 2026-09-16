import { createHash } from 'node:crypto';

// Electron 饭角只读传输；签名凭据和原始响应始终留在主进程。
export function signFanjiaoGet(params, secret) {
    return createHash('md5').update(Object.keys(params).sort()
        .map(key => `${key}=${params[key]}`).join('&') + secret).digest('hex');
}

export function createFanjiaoClient(secret) {
    if (!secret) throw new Error('Missing Fanjiao signing credential');
    const paths = new Set(['/walkman/api/search/keyword', '/walkman/api/album/album_info',
        '/walkman/api/album/audio', '/walkman/api/audio/info']);
    return {
        async get(path, params, signal) {
            if (!paths.has(path)) throw new Error('Unsupported Fanjiao API');
            const headers = { signature: signFanjiaoGet(params, secret) };
            if (path === '/walkman/api/search/keyword') headers.sm_device = '1';
            const response = await fetch(`https://api.fanjiao.co${path}?${new URLSearchParams(params)}`, {
                headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
            });
            if (!response.ok) throw new Error(`Fanjiao HTTP ${response.status}`);
            const document = await response.json();
            if (![0, '0'].includes(document.code) || !document.data || typeof document.data !== 'object') {
                throw new Error(`Fanjiao API ${Number(document.code) || 'invalid-response'}`);
            }
            return document.data;
        },
    };
}
