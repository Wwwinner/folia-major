import { createHash } from 'node:crypto';

// 原生饭角只读传输，供手动验证和后续 provider adapter 复用；原始响应只在实现层流转。
export function signFanjiaoGet(params, secret) {
    return createHash('md5').update(Object.keys(params).sort()
        .map(key => `${key}=${params[key]}`).join('&') + secret).digest('hex');
}

export function createFanjiaoClient(secret) {
    if (!secret) throw new Error('Missing Fanjiao signing credential');
    const paths = new Set(['/walkman/api/search/keyword', '/walkman/api/album/album_info',
        '/walkman/api/album/audio', '/walkman/api/audio/info']);
    return {
        async get(path, params) {
            if (!paths.has(path)) throw new Error('Unsupported probe API');
            const headers = { signature: signFanjiaoGet(params, secret) };
            if (path === '/walkman/api/search/keyword') headers.sm_device = '1';
            const response = await fetch(`https://api.fanjiao.co${path}?${new URLSearchParams(params)}`, {
                headers, redirect: 'error', signal: AbortSignal.timeout(20000),
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
