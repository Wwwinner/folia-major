import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { fetchChromiumMedia } from '../../../electron/fanjiao/chromiumMediaFetch.mjs';
import { readMediaAsset } from '../../../electron/fanjiao/session.mjs';

// 真实 Electron 事件合同：中文响应头、流中断、取消与资源限制均不能使主进程抛出未捕获异常。
function fixture(status = 200) {
    const response = Object.assign(new EventEmitter(), { statusCode: status,
        headers: { 'content-disposition': 'attachment; filename="白月光字幕.json"' } });
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn() });
    const net = { request: vi.fn(() => request) };
    const session = {};
    return { response, request, net, session };
}
describe('Chromium media stream', () => {
    it('accepts non-Latin response headers and streams exact bytes through Chromium', async () => {
        const { net, session, request, response } = fixture();
        const pending = fetchChromiumMedia(net, session, new URL('https://play.fanjiao.co/a.ts'));
        expect(net.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://play.fanjiao.co/a.ts', session, redirect: 'error' }));
        request.emit('close'); request.emit('response', response);
        const result = await pending;
        const body = result.arrayBuffer();
        response.emit('data', Buffer.from([1, 2])); request.emit('close');
        response.emit('data', Buffer.from([3])); response.emit('end');
        expect([...new Uint8Array(await body)]).toEqual([1, 2, 3]);
        expect(result.status).toBe(200);
    });
    it('propagates an abort before headers and during the response', async () => {
        for (const received of [false, true]) {
            const { net, session, request, response } = fixture();
            const controller = new AbortController();
            const pending = fetchChromiumMedia(net, session, 'https://play.fanjiao.co/a.ts', { signal: controller.signal });
            if (received) request.emit('response', response);
            const result = received ? (await pending).arrayBuffer() : pending;
            const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
            controller.abort(); request.emit('abort');
            await rejection;
            expect(request.abort).toHaveBeenCalledOnce();
        }
    });
    it('rejects failed and truncated transfers instead of accepting partial audio', async () => {
        for (const received of [false, true]) {
            const { net, session, request, response } = fixture();
            const pending = fetchChromiumMedia(net, session, 'https://play.fanjiao.co/a.ts');
            if (received) request.emit('response', response);
            const result = received ? (await pending).arrayBuffer() : pending;
            const rejection = expect(result).rejects.toBeInstanceOf(TypeError);
            if (received) { response.emit('data', Buffer.from('partial')); response.emit('aborted'); }
            else request.emit('error', new Error('net::ERR_FAILED'));
            request.emit('close');
            await rejection;
        }
    });
    it('keeps HTTP refusal status and cancels on byte-limit overflow', async () => {
        const refused = fixture(403);
        const pending = fetchChromiumMedia(refused.net, refused.session, 'https://play.fanjiao.co/a.ts');
        refused.request.emit('response', refused.response);
        const result = await pending;
        expect(result.status).toBe(403); expect(result.ok).toBe(false);
        await result.body!.cancel(); expect(refused.request.abort).toHaveBeenCalledOnce();

        const { net, session, request, response } = fixture();
        const bytes = readMediaAsset('https://play.fanjiao.co/a.ts', undefined, 2,
            (url, options) => fetchChromiumMedia(net, session, url, options));
        const rejection = expect(bytes).rejects.toThrow('size limit');
        request.emit('response', response);
        response.emit('data', Buffer.from('too large'));
        await rejection;
        expect(request.abort).toHaveBeenCalledOnce();
    });
});
