import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { waitForEpisodePrefetchReadiness } from '@/services/episodePrefetchReadiness';
import { rememberEpisodeSource, setSegmentedAudioSource } from '@/services/playbackMediaSource';

// 当前集的首片/缓冲优先；别的音轨 playing 不得误开启后台预取，取消后移除监听。
const song: SongResult = { id: '1', name: '第一期', artists: [], album: { id: 'a', name: '剧' }, durationMs: 300000,
    sourceRef: { kind: 'online', providerId: 'fanjiao', mediaId: '1' }, episode: { kind: 'main' } };
function fixture() {
    let bufferEnd = 0;
    const audio = { paused: false, ended: false, seeking: false, readyState: 0, currentTime: 0, duration: 300,
        buffered: { get length() { return bufferEnd > 0 ? 1 : 0; }, start: () => 0, end: () => bufferEnd } } as unknown as HTMLAudioElement;
    const document = Object.assign(new EventTarget(), { querySelectorAll: () => [audio] });
    vi.stubGlobal('document', document);
    const source = rememberEpisodeSource(song, `folia-hls://fanjiao/1/${'a'.repeat(48)}/index.m3u8`);
    setSegmentedAudioSource(audio, source);
    return { audio, document, buffer: (end: number) => { bufferEnd = end; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('episode prefetch priority', () => {
    it('waits for current playback and enough forward buffer', async () => {
        const { audio, document, buffer } = fixture();
        const ready = vi.fn();
        const pending = waitForEpisodePrefetchReadiness(song, new AbortController().signal).then(ready);
        document.dispatchEvent(new Event('playing')); await Promise.resolve();
        expect(ready).not.toHaveBeenCalled();
        Object.assign(audio, { readyState: 3 }); buffer(10);
        document.dispatchEvent(new Event('progress')); await Promise.resolve();
        expect(ready).not.toHaveBeenCalled();
        buffer(31); document.dispatchEvent(new Event('progress'));
        await pending; expect(ready).toHaveBeenCalledWith(true);
    });
    it('allows a short episode that has buffered to the end', async () => {
        const { audio, buffer } = fixture();
        Object.assign(audio, { readyState: 4, duration: 8 }); buffer(8);
        await expect(waitForEpisodePrefetchReadiness(song, new AbortController().signal)).resolves.toBe(true);
    });
    it('does not accept paused playback or a different source and cleans up on cancellation', async () => {
        const { audio, document, buffer } = fixture();
        Object.assign(audio, { readyState: 4, paused: true }); buffer(90);
        const ready = vi.fn(), controller = new AbortController();
        const pending = waitForEpisodePrefetchReadiness(song, controller.signal).then(ready);
        document.dispatchEvent(new Event('playing')); await Promise.resolve();
        expect(ready).not.toHaveBeenCalled();
        setSegmentedAudioSource(audio, 'folia-hls://other'); Object.assign(audio, { paused: false });
        document.dispatchEvent(new Event('playing')); await Promise.resolve();
        expect(ready).not.toHaveBeenCalled();
        const remove = vi.spyOn(document, 'removeEventListener');
        controller.abort(); await pending;
        expect(ready).toHaveBeenCalledWith(false);
        expect(remove).toHaveBeenCalledTimes(5);
    });
});
