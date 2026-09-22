import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetchSegmentedAudioStart } from '@/services/segmentedAudioPrefetch';

// 预取只访问既有本地媒体会话的首片，不遍历清单、不下载整集。
const source = `folia-hls://fanjiao/123/${'a'.repeat(48)}/index.m3u8`;
afterEach(() => vi.unstubAllGlobals());
describe('segmented audio prefetch', () => {
    it('warms exactly one first segment in the existing session', async () => {
        const fetch = vi.fn(async () => new Response('segment'));
        vi.stubGlobal('fetch', fetch);
        const { signal } = new AbortController();
        await expect(prefetchSegmentedAudioStart(source, signal)).resolves.toBe(true);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(source.replace('index.m3u8', 'segment/0.ts'), { signal });
    });
    it('does not fetch arbitrary, malformed or already-cancelled sources', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        for (const url of ['https://example.test/audio.mp3', source + '?extra=1', source.replace('fanjiao', 'foreign'), 'bad']) {
            await expect(prefetchSegmentedAudioStart(url, new AbortController().signal)).resolves.toBe(false);
        }
        const controller = new AbortController(); controller.abort();
        await expect(prefetchSegmentedAudioStart(source, controller.signal)).resolves.toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('keeps network failure and cancellation non-fatal', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 502 })).mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
        vi.stubGlobal('fetch', fetch);
        await expect(prefetchSegmentedAudioStart(source, new AbortController().signal)).resolves.toBe(false);
        await expect(prefetchSegmentedAudioStart(source, new AbortController().signal)).resolves.toBe(false);
    });
});
