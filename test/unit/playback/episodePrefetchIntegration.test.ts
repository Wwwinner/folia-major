import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { omni } from '@/services/onlineMusic/omni';
import { clearPrefetchRuntime, getPrefetchedData, prefetchNearbySongs } from '@/services/prefetchService';
import { rememberEpisodeSource, setSegmentedAudioSource } from '@/services/playbackMediaSource';

// 正式预取入口须在首片等待期间发布会话，并在队列取消后停止，不能重新建源或补下载整集。
vi.mock('@/services/onlineMusic/resourceCache', () => ({ hasCachedSongAudio: vi.fn(async () => false), getSongCacheWithLegacyMigration: vi.fn(async () => null) }));
vi.mock('@/services/automix/profileService', () => ({ ensureTrackProfile: vi.fn(), setAnalysisScope: vi.fn() }));
const song = (id: string): SongResult => ({ id, name: id, artists: [], album: { id: 'album', name: 'Album' },
    durationMs: 300000, sourceRef: { kind: 'online', providerId: 'fanjiao', mediaId: id }, episode: { kind: 'main' } });
afterEach(() => { clearPrefetchRuntime(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('episode prefetch integration', () => {
    it('publishes the same source before the warm request finishes and aborts on scope change', async () => {
        const source = `folia-hls://fanjiao/2/${'b'.repeat(48)}/index.m3u8`;
        vi.spyOn(omni, 'canPlaySong').mockReturnValue(true);
        const getSource = vi.spyOn(omni, 'getAudioSource').mockResolvedValue({ url: source, fetchedAt: Date.now(), quality: 'standard' });
        let signal: AbortSignal | undefined;
        const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
            signal = options.signal;
            signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
        }));
        vi.stubGlobal('fetch', fetch);
        vi.stubGlobal('window', { requestIdleCallback: true });
        vi.stubGlobal('requestIdleCallback', (callback: () => void) => { callback(); return 1; });
        const current = song('1'), next = song('2');
        const audio = { paused: false, ended: false, seeking: false, currentTime: 0, readyState: 0, duration: 300,
            buffered: { length: 1, start: () => 0, end: () => 60 } } as unknown as HTMLAudioElement;
        const document = Object.assign(new EventTarget(), { querySelectorAll: () => [audio] });
        vi.stubGlobal('document', document);
        const playingSource = rememberEpisodeSource(current, source.replace('/2/', '/1/'));
        setSegmentedAudioSource(audio, playingSource);
        await prefetchNearbySongs(current, [current, next], 'standard');
        await Promise.resolve();
        expect(getSource).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        Object.assign(audio, { readyState: 3 });
        document.dispatchEvent(new Event('playing'));
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(getPrefetchedData(next, 'standard')?.audioUrl).toBe(source);
        expect(getSource).toHaveBeenCalledOnce();
        clearPrefetchRuntime();
        expect(signal?.aborted).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(getPrefetchedData(next, 'standard')).toBeNull();
        expect(fetch).toHaveBeenCalledOnce();
    });
});
