import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMediaAsset } from '../../../electron/fanjiao/session.mjs';

// 上游短暂错误只重试有限次；授权拒绝、资源限制和会话取消不能被重试掩盖。
const url = 'https://play.fanjiao.co/fixture.ts';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Fanjiao media retry', () => {
    it('allows 60 seconds for full fragments while keeping manifests at 20 seconds', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        vi.stubGlobal('fetch', vi.fn(async () => new Response('complete')));
        await readMediaAsset(url);
        expect(timeout).toHaveBeenLastCalledWith(60000);
        await readMediaAsset('https://play.fanjiao.co/index.m3u8');
        expect(timeout).toHaveBeenLastCalledWith(20000);
    });
    it('recovers temporary HTTP and network failures within one shared deadline', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response('complete'));
        vi.stubGlobal('fetch', fetch);
        const pending = readMediaAsset(url);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await pending).toEqual(Buffer.from('complete'));
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[0][1].signal).toBe(fetch.mock.calls[2][1].signal);
    });
    it('discards a partial response before retrying a broken response body', async () => {
        vi.useFakeTimers();
        let pulls = 0;
        const body = new ReadableStream({ pull(controller) {
            if (pulls++ === 0) controller.enqueue(new Uint8Array([1, 2]));
            else controller.error(new TypeError('connection terminated'));
        } });
        const fetch = vi.fn().mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response('fresh'));
        vi.stubGlobal('fetch', fetch);
        const pending = readMediaAsset(url);
        await vi.advanceTimersByTimeAsync(300);
        expect(await pending).toEqual(Buffer.from('fresh'));
    });
    it.each([403, 404])('does not retry HTTP %s', async status => {
        const fetch = vi.fn(async () => new Response(null, { status }));
        vi.stubGlobal('fetch', fetch);
        await expect(readMediaAsset(url)).rejects.toMatchObject({ status });
        expect(fetch).toHaveBeenCalledOnce();
    });
    it('limits retries and respects the maximum resource size', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(async () => new Response(null, { status: 502 }));
        vi.stubGlobal('fetch', fetch);
        const result = expect(readMediaAsset(url)).rejects.toMatchObject({ status: 502 });
        await vi.advanceTimersByTimeAsync(1000);
        await result;
        expect(fetch).toHaveBeenCalledTimes(3);
        fetch.mockImplementation(async () => new Response('too large'));
        await expect(readMediaAsset(url, undefined, 2)).rejects.toThrow('size limit');
        expect(fetch).toHaveBeenCalledTimes(4);
    });
    it('aborts backoff immediately when a session is disposed', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const fetch = vi.fn(async () => new Response(null, { status: 503 }));
        vi.stubGlobal('fetch', fetch);
        const result = expect(readMediaAsset(url, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(1);
        controller.abort();
        await result;
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch).toHaveBeenCalledOnce();
    });
});
