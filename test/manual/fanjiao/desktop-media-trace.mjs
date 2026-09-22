import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 观察 Node 与独立 Chromium 媒体会话，不替换 fetch 或消费响应体；只保存脱敏下载阶段。
export async function traceDesktopMedia(app, output) {
    const filename = path.join(output, 'media-trace.jsonl');
    writeFileSync(filename, '');
    let pending = '';
    app.process().stdout.on('data', bytes => {
        pending += bytes.toString();
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        for (const line of lines) if (line.startsWith('[Media probe] ')) {
            const record = line.slice('[Media probe] '.length);
            appendFileSync(filename, record + '\n');
            console.log('[Media probe]', record);
        }
    });
    await app.evaluate(({ session }) => {
        const { channel } = process.getBuiltinModule('node:diagnostics_channel');
        const records = new WeakMap();
        let nextId = 0, active = 0;
        const emit = record => console.log('[Media probe]', JSON.stringify(record));
        channel('undici:request:create').subscribe(({ request }) => {
            const pathname = new URL(request.path, request.origin).pathname;
            if (!/\.(?:ts|m3u8)$/.test(pathname)) return;
            const record = { id: ++nextId, transport: 'node', kind: pathname.endsWith('.ts') ? 'segment' : 'manifest',
                started: performance.now(), concurrent: ++active };
            records.set(request, record);
            emit({ id: record.id, kind: record.kind, stage: 'start', concurrent: active });
        });
        channel('undici:request:headers').subscribe(({ request, response }) => {
            const record = records.get(request); if (!record) return;
            record.headersMs = Math.round(performance.now() - record.started);
            record.status = response.statusCode;
            for (let i = 0; i < response.headers.length; i += 2) {
                if (String(response.headers[i]).toLowerCase() === 'content-length') record.bytes = Number(String(response.headers[i + 1]));
            }
            emit({ id: record.id, stage: 'headers', headersMs: record.headersMs, status: record.status, bytes: record.bytes });
        });
        for (const [event, stage] of [['trailers', 'complete'], ['error', 'error']]) {
            channel(`undici:request:${event}`).subscribe(({ request, error }) => {
                const record = records.get(request); if (!record) return;
                records.delete(request); active--;
                const { started, ...summary } = record;
                emit({ ...summary, stage, totalMs: Math.round(performance.now() - started), error: error?.name });
            });
        }
        // 此 partition 仅由饭角显式代理使用，没有其他来源的 webRequest handler。
        const native = session.fromPartition('folia-fanjiao-media');
        const nativeRecords = new Map();
        native.webRequest.onBeforeRequest((details, callback) => {
            const pathname = new URL(details.url).pathname;
            if (/\.(?:ts|m3u8)$/.test(pathname)) {
                const record = { id: ++nextId, transport: 'chromium', kind: pathname.endsWith('.ts') ? 'segment' : 'manifest',
                    started: performance.now() };
                nativeRecords.set(details.id, record);
                emit({ id: record.id, transport: 'chromium', kind: record.kind, stage: 'start' });
            }
            callback({});
        });
        native.webRequest.onHeadersReceived((details, callback) => {
            const record = nativeRecords.get(details.id);
            if (record) {
                record.headersMs = Math.round(performance.now() - record.started);
                record.status = details.statusCode;
                const header = Object.entries(details.responseHeaders || {}).find(([key]) => key.toLowerCase() === 'content-length');
                if (header) record.bytes = Number(header[1][0]);
            }
            callback({});
        });
        const finishNative = (details, stage) => {
            const record = nativeRecords.get(details.id); if (!record) return;
            nativeRecords.delete(details.id);
            const { started, ...summary } = record;
            emit({ ...summary, stage, totalMs: Math.round(performance.now() - started), error: stage === 'error' ? details.error : undefined });
        };
        native.webRequest.onCompleted(details => finishNative(details, 'complete'));
        native.webRequest.onErrorOccurred(details => finishNative(details, 'error'));
    });
}
