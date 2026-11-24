import type { FoliumSourceNet } from '@folia/folium';

// sources/fanjiao/main/chromiumMediaFetch.ts
// Chromium GET 字节流适配器；字幕响应头可能含中文文件名，不经过 Session.fetch 的 ByteString 转换。

export type FanjiaoChromiumNet = Pick<FoliumSourceNet, 'request'>;

export interface FanjiaoChromiumFetchOptions {
    signal?: AbortSignal;
    headers?: HeadersInit;
}

export function fetchChromiumMedia(
    net: FanjiaoChromiumNet,
    url: string | URL,
    options: FanjiaoChromiumFetchOptions = {},
): Promise<Response> {
    const abortError = (signal?: AbortSignal): Error => (
        signal?.reason instanceof Error ? signal.reason : new DOMException('Cancelled', 'AbortError')
    );
    return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) { reject(abortError(signal)); return; }
        const request = net.request({ url: url instanceof URL ? url.href : url, method: 'GET', redirect: 'error',
            credentials: 'omit', headers: Object.fromEntries(new Headers(options.headers)) });
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
        let finished = false;
        const finish = (error?: unknown) => {
            if (finished) return;
            finished = true;
            signal?.removeEventListener('abort', abort);
            if (error !== undefined) {
                const reason = error instanceof Error ? error : new Error('Chromium media download failed');
                if (controller) controller.error(reason);
                else reject(reason);
            } else controller?.close();
        };
        const networkError = (error: unknown) => finish(new TypeError('Chromium media download failed', { cause: error }));
        const abort = () => {
            finish(abortError(signal));
            request.abort();
        };
        request.on('error', networkError);
        request.on('abort', () => finish(abortError(signal)));
        // Chromium 的请求 close 可先于 response；完整性由响应 end/error/aborted 和下载时限判断。
        request.on('response', response => {
            response.on('error', networkError);
            if (finished) return;
            const body = new ReadableStream<Uint8Array>({
                start(value) { controller = value; },
                cancel() {
                    finished = true;
                    signal?.removeEventListener('abort', abort);
                    request.abort();
                },
            });
            response.on('end', () => finish());
            response.on('aborted', () => networkError(new Error('Interrupted media response')));
            response.on('data', chunk => { if (!finished) controller?.enqueue(chunk); });
            // 上层只读取状态与字节；不把上游 Content-Disposition 等头转成 WHATWG Headers。
            resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : body, { status: response.statusCode }));
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        else request.end();
    });
}
