import { createHash } from 'node:crypto';
import { record } from './normalize';

// sources/fanjiao/main/client.ts
// 饭角只读目录传输；签名凭据和原始响应始终留在主进程。

export type FanjiaoFetchInit = Record<string, unknown> & {
    headers?: Record<string, string>;
    redirect?: 'error';
    signal?: AbortSignal;
};

export type FanjiaoFetch = (url: string, init: FanjiaoFetchInit) => Promise<Response>;

export interface FanjiaoClient {
    get(
        path: string,
        params: Record<string, string | number>,
        signal?: AbortSignal,
        options?: { fresh?: boolean },
    ): Promise<Record<string, unknown>>;
    clear?(): void;
}

const defaultFetch: FanjiaoFetch = (url, init) => fetch(url, init);

export function signFanjiaoGet(params: Record<string, string | number>, secret: string): string {
    return createHash('md5').update(Object.keys(params).sort()
        .map(key => `${key}=${params[key]}`).join('&') + secret).digest('hex');
}

const PATHS: Record<string, true> = {
    '/walkman/api/search/keyword': true, '/walkman/api/album/album_info': true,
    '/walkman/api/album/audio': true, '/walkman/api/audio/info': true,
    '/walkman/api/recommend/home/limit': true, '/walkman/api/recommend/major': true,
};

// The home modules and the major lists behind them are the old client's verified layout.
const APP_USER_AGENT = 'fanjiao/3.15.1 140 Android 15';
const APP_USER_AGENT_PATHS: Record<string, true> = {
    '/walkman/api/recommend/home/limit': true, '/walkman/api/recommend/major': true,
};

export function createFanjiaoClient(secret: string, fetchImpl: FanjiaoFetch = defaultFetch): FanjiaoClient {
    if (!secret) throw new Error('Missing Fanjiao signing credential');
    return {
        async get(path, params, signal) {
            if (!Object.hasOwn(PATHS, path)) throw new Error('Unsupported Fanjiao API');
            const headers: Record<string, string> = { signature: signFanjiaoGet(params, secret) };
            if (path === '/walkman/api/search/keyword') headers.sm_device = '1';
            // 首页根据客户端 UA 决定栏目；默认 Node UA 会成功返回空模块。major 沿用同一客户端 UA。
            if (Object.hasOwn(APP_USER_AGENT_PATHS, path)) headers['user-agent'] = APP_USER_AGENT;
            const search = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) search.set(key, String(value));
            const response = await fetchImpl(`https://api.fanjiao.co${path}?${search}`, {
                headers, redirect: 'error',
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
            });
            if (!response.ok) throw new Error(`Fanjiao HTTP ${response.status}`);
            const body: unknown = await response.json();
            const document = record(body);
            if (document.code !== 0 && document.code !== '0') throw new Error('Fanjiao API returned an unexpected code');
            const data = record(document.data);
            if (!document.data || typeof document.data !== 'object') throw new Error('Fanjiao API returned no data');
            return data;
        },
    };
}
