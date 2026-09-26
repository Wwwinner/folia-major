// Chromium GET 字节流适配器；字幕响应头可能含中文文件名，不经过 Session.fetch 的 ByteString 转换。
export function fetchChromiumMedia(net, session, url, options = {}) {
    return new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) { reject(signal.reason); return; }
        const request = net.request({ url: String(url), session, method: 'GET', redirect: 'error',
            credentials: 'omit', headers: Object.fromEntries(new Headers(options.headers)) });
        let controller;
        let finished = false;
        const finish = error => {
            if (finished) return;
            finished = true;
            signal?.removeEventListener('abort', abort);
            if (error) {
                if (controller) controller.error(error);
                else reject(error);
            } else controller?.close();
        };
        const networkError = error => finish(new TypeError('Chromium media download failed', { cause: error }));
        const abort = () => {
            finish(signal?.reason || new DOMException('Cancelled', 'AbortError'));
            request.abort();
        };
        request.on('error', networkError);
        request.on('abort', () => finish(signal?.reason || new DOMException('Cancelled', 'AbortError')));
        // Chromium 的请求 close 可先于 response；完整性由响应 end/error/aborted 和下载时限判断。
        request.on('response', response => {
            response.on('error', networkError);
            if (finished) return;
            const body = new ReadableStream({
                start(value) { controller = value; },
                cancel() {
                    finished = true;
                    signal?.removeEventListener('abort', abort);
                    request.abort();
                },
            });
            response.on('end', () => finish());
            response.on('aborted', () => networkError(new Error('Interrupted media response')));
            response.on('data', chunk => { if (!finished) controller.enqueue(chunk); });
            // 上层只读取状态与字节；不把上游 Content-Disposition 等头转成 WHATWG Headers。
            resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : body, { status: response.statusCode }));
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        else request.end();
    });
}
