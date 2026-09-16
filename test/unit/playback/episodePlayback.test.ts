import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { resolveQueueNeighborIndex, getEpisodeKey, getResumePosition } from '../../../src/utils/episodePlayback';
import { resolvePlaybackNeighbors } from '../../../src/utils/playbackNeighbors';
import { resolveNextUpTrack } from '../../../src/components/app/overlays/now-playing-toast/resolveNextUpTrack';
import { createEpisodeProgressRecorder } from '../../../src/services/episodeProgressRecorder';
import { rememberEpisodeSource, setSegmentedAudioSource } from '../../../src/services/playbackMediaSource';

// 覆盖正片稳定顺序、源身份竞争和持久化时机，不以 DOM 加载归零推断新的收听进度。
const episode = (id: string, kind: 'main' | 'extra' | 'unknown' = 'main', providerId = 'fanjiao'): SongResult => ({
    id, name: id, artists: [], album: { id: 'album', name: 'Album' }, durationMs: 100000,
    sourceRef: { kind: 'online', providerId, mediaId: id }, episode: { kind },
});
function recorderFixture(song = episode('1')) {
    let now = 0;
    const source = rememberEpisodeSource(song, `folia-hls://fanjiao/${song.id}/token/index.m3u8`);
    const events = new EventTarget();
    const view = new EventTarget();
    const audio = Object.assign(events, { currentTime: 0, duration: 100, readyState: 1, paused: true,
        seeking: false, error: null, currentSrc: 'blob:media', ownerDocument: { defaultView: view },
        getAttribute: () => 'blob:media' }) as unknown as HTMLAudioElement;
    setSegmentedAudioSource(audio, source);
    const save = vi.fn();
    const dispose = createEpisodeProgressRecorder(audio, song, source, save, () => now);
    const fire = (name: string) => audio.dispatchEvent(new Event(name));
    return { audio, source, save, fire, dispose, view, advance: (ms: number) => { now += ms; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('episode queues', () => {
    it('keeps mini episodes among main episodes in original provider order', () => {
        const tracks = [episode('trailer', 'extra'), episode('1'), episode('mini'), episode('outtake', 'extra'), episode('2')];
        const original = [...tracks];
        expect(resolveQueueNeighborIndex(tracks, tracks[2], 1, 'off', true)).toBe(4);
        expect(resolveQueueNeighborIndex(tracks, tracks[4], -1, 'off', true)).toBe(2);
        expect(resolveQueueNeighborIndex(tracks, tracks[3], 1, 'off', true)).toBe(4);
        expect(resolveQueueNeighborIndex(tracks, tracks[3], -1, 'off', true)).toBe(2);
        expect(resolveQueueNeighborIndex(tracks, tracks[2], 1, 'off', false)).toBe(3);
        expect(tracks).toEqual(original);
    });
    it('leaves music alone and never guesses that unknown episodes are main', () => {
        const song = { ...episode('music'), episode: undefined };
        const tracks = [song, { ...song, id: 'music2', sourceRef: { kind: 'online' as const, providerId: 'other', mediaId: '2' } }];
        expect(resolveQueueNeighborIndex(tracks, song, 1, 'off', true)).toBe(1);
        const unknown = episode('unknown', 'unknown');
        expect(resolveQueueNeighborIndex([unknown], unknown, 1, 'all', true)).toBe(-1);
        expect(getEpisodeKey(song)).toBeNull();
        expect(getEpisodeKey(episode('1'))).not.toBe(getEpisodeKey(episode('1', 'main', 'other')));
    });
    it('shares main-episode targets with buttons and next-up previews, including loop boundaries', () => {
        const tracks = [episode('intro', 'extra'), episode('1'), episode('extra', 'extra'), episode('mini'), episode('tail', 'extra')];
        const options = { playQueue: tracks, currentSong: tracks[1], loopMode: 'off' as const, isFmMode: false, isStageActive: false, mainEpisodesOnly: true };
        expect(resolvePlaybackNeighbors(options).next.key).toBe('online:fanjiao:mini');
        expect(resolvePlaybackNeighbors(options).prev.canGo).toBe(false);
        expect(resolveNextUpTrack({ ...options, song: tracks[1] })).toBe(tracks[3]);
        expect(resolveQueueNeighborIndex(tracks, tracks[3], 1, 'off', true)).toBe(-1);
        expect(resolveQueueNeighborIndex(tracks, tracks[3], 1, 'all', true)).toBe(1);
        expect(resolveQueueNeighborIndex(tracks, tracks[1], -1, 'all', true)).toBe(3);
        expect(resolveNextUpTrack({ ...options, song: tracks[1], loopMode: 'one' })).toBeNull();
        expect(resolveQueueNeighborIndex(tracks, tracks[1], 1, 'one', true)).toBe(3);
        expect(resolveQueueNeighborIndex(tracks, tracks[1], 1, 'off', true, candidate => candidate.id !== 'mini')).toBe(-1);
    });
});

describe('episode progress recording', () => {
    it('does not overwrite history when loading a paused element at zero', () => {
        const f = recorderFixture();
        f.fire('loadedmetadata'); f.fire('pause'); f.dispose();
        expect(f.save).not.toHaveBeenCalled();
    });
    it('throttles playback writes, then flushes paused and seeked positions', () => {
        const f = recorderFixture();
        Object.assign(f.audio, { paused: false }); f.fire('playing');
        for (let i = 1; i <= 12; i++) { f.audio.currentTime = i; f.advance(1000); f.fire('timeupdate'); }
        expect(f.save).toHaveBeenCalledTimes(3);
        Object.assign(f.audio, { paused: true }); f.fire('pause');
        expect(f.save.mock.lastCall).toEqual(['online:fanjiao:1', expect.objectContaining({ position: 12, completed: false })]);
        f.audio.currentTime = 60; f.fire('seeked');
        expect(f.save.mock.lastCall?.[1].position).toBe(60);
        f.dispose();
    });
    it('preserves the outgoing identity and position across source replacement', () => {
        const f = recorderFixture();
        Object.assign(f.audio, { paused: false }); f.fire('playing');
        f.audio.currentTime = 24; f.advance(1000); f.fire('timeupdate');
        setSegmentedAudioSource(f.audio, 'folia-hls://fanjiao/2/new/index.m3u8');
        f.audio.currentTime = 0; f.fire('emptied'); f.dispose();
        expect(f.save.mock.lastCall).toEqual(['online:fanjiao:1', expect.objectContaining({ position: 24 })]);
        const wrongSave = vi.fn();
        const cleanup = createEpisodeProgressRecorder(f.audio, episode('2'), f.source, wrongSave);
        f.fire('playing'); cleanup();
        expect(wrongSave).not.toHaveBeenCalled();
    });
    it('flushes on exit, marks ended complete, and returns completed episodes to the beginning', () => {
        const f = recorderFixture();
        Object.assign(f.audio, { paused: false }); f.fire('playing');
        f.audio.currentTime = 35; f.view.dispatchEvent(new Event('pagehide'));
        expect(f.save.mock.lastCall?.[1].position).toBe(35);
        f.audio.currentTime = 100; f.fire('ended');
        expect(f.save.mock.lastCall?.[1].completed).toBe(true);
        expect(getResumePosition(f.save.mock.lastCall?.[1])).toBeNull();
        expect(getResumePosition({ position: 35, duration: 100, completed: false, updatedAt: 1 })).toBe(35);
        f.dispose();
    });
    it('reloads persisted per-episode records and does not restore a mismatched source', async () => {
        vi.resetModules();
        const values = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value) });
        const store = await import('../../../src/stores/useEpisodePlaybackStore');
        store.useEpisodePlaybackStore.getState().saveProgress('online:fanjiao:1', { position: 42, duration: 100, completed: false, updatedAt: 1 });
        vi.resetModules();
        const restored = await import('../../../src/stores/useEpisodePlaybackStore');
        expect(restored.getEpisodeResumePosition(episode('1'))).toBe(42);
        expect(restored.getEpisodeResumePosition(episode('2'))).toBeNull();
        expect(restored.getEpisodeResumePosition(episode('1'), 'other-source')).toBeNull();
        restored.useEpisodePlaybackStore.getState().restartEpisode(episode('1'));
        restored.useEpisodePlaybackStore.getState().saveProgress('online:fanjiao:1', { position: 45, duration: 100, completed: false, updatedAt: 2 });
        expect(restored.getEpisodeResumePosition(episode('1'))).toBe(0);
        expect(restored.getEpisodeResumePosition(episode('1'))).toBeNull();
    });
});
