import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { episodeHistoryDay, episodeMetadataFromSong, episodeSongFromProgress, groupEpisodeHistory, normalizeEpisodeProgress } from '../../../src/utils/episodeHistory';

// 验证旧记录迁移、按剧聚合和历史时间，不让补齐元数据制造收听行为。
const song = (id = '1', album = 'a'): SongResult => ({
    id, name: `Episode ${id}`, artists: [{ id: 'studio', name: 'Studio' }],
    album: { id: album, name: `Album ${album}`, coverUrl: 'https://example.com/cover.jpg' }, durationMs: 100000,
    sourceRef: { kind: 'online', providerId: 'fanjiao', mediaId: id }, episode: { kind: 'main' },
});
const legacy = { position: 42, duration: 100, completed: false, updatedAt: 1000 };
afterEach(() => vi.unstubAllGlobals());

describe('listening history', () => {
    it('preserves legacy progress and only persists display metadata', () => {
        expect(normalizeEpisodeProgress(legacy)).toEqual(legacy);
        const metadata = episodeMetadataFromSong(song());
        const record = normalizeEpisodeProgress({ ...legacy, mediaUrl: 'private', metadata: { ...metadata, playAuth: 'private' } })!;
        expect(record).toEqual({ ...legacy, metadata });
        expect(episodeSongFromProgress('online:fanjiao:1', record)).toMatchObject({
            name: 'Episode 1', album: { id: 'a', catalogRef: { providerId: 'fanjiao', kind: 'album', id: 'a' } },
        });
        expect(normalizeEpisodeProgress({ ...legacy, lastPlayedAt: NaN })).toBeNull();
    });
    it('groups each album by actual last listening time and retains completed episodes', () => {
        const progress = {
            'online:fanjiao:1': { ...legacy, metadata: episodeMetadataFromSong(song()), lastPlayedAt: 3000 },
            'online:fanjiao:2': { ...legacy, metadata: episodeMetadataFromSong(song('2')), updatedAt: 9000, lastPlayedAt: 2000, completed: true },
            'online:fanjiao:3': { ...legacy, metadata: episodeMetadataFromSong(song('3', 'b')), lastPlayedAt: 4000 },
            'online:fanjiao:4': { ...legacy, metadata: episodeMetadataFromSong(song('4', 'c')), lastPlayedAt: 0 },
            'online:other:1': { ...legacy, metadata: episodeMetadataFromSong(song()) },
        };
        const groups = groupEpisodeHistory(progress, 'fanjiao');
        expect(groups.map(group => group.album.id)).toEqual(['b', 'a']);
        expect(groups[1].episodes.map(record => record.song.id)).toEqual(['1', '2']);
        expect(groups[1].episodes[1].progress.completed).toBe(true);
    });
    it('uses local calendar dates for today, yesterday and earlier', () => {
        const today = new Date(2026, 8, 18, 0, 5).getTime();
        expect(episodeHistoryDay(new Date(2026, 8, 18, 0, 0).getTime(), today)).toBe('today');
        expect(episodeHistoryDay(new Date(2026, 8, 17, 23, 59).getTime(), today)).toBe('yesterday');
        expect(episodeHistoryDay(new Date(2026, 8, 16, 23, 59).getTime(), today)).toBe('earlier');
    });
    it('hydrates existing records without changing position, timestamps or creating new entries', async () => {
        vi.resetModules();
        const values = new Map([['folia_episode_progress_v1', JSON.stringify({ 'online:fanjiao:1': legacy })]]);
        vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value) });
        const { useEpisodePlaybackStore, getEpisodeResumePosition } = await import('../../../src/stores/useEpisodePlaybackStore');
        useEpisodePlaybackStore.getState().hydrateMetadata([song(), song('2')]);
        expect(Object.keys(useEpisodePlaybackStore.getState().progress)).toEqual(['online:fanjiao:1']);
        expect(useEpisodePlaybackStore.getState().progress['online:fanjiao:1']).toEqual({ ...legacy, metadata: episodeMetadataFromSong(song()) });
        useEpisodePlaybackStore.getState().saveProgress('online:fanjiao:1', { ...legacy, position: 55, metadata: undefined, lastPlayedAt: 0 });
        expect(useEpisodePlaybackStore.getState().progress['online:fanjiao:1']).toMatchObject({ position: 55, lastPlayedAt: 1000, metadata: { albumId: 'a' } });
        useEpisodePlaybackStore.getState().restartEpisode(song());
        useEpisodePlaybackStore.getState().saveProgress('online:fanjiao:1', { ...legacy, position: 70 });
        expect(useEpisodePlaybackStore.getState().progress['online:fanjiao:1']).toMatchObject({ position: 0, lastPlayedAt: 1000, metadata: { albumId: 'a' } });
        expect(getEpisodeResumePosition(song())).toBe(0);
        vi.resetModules();
        const restored = await import('../../../src/stores/useEpisodePlaybackStore');
        expect(groupEpisodeHistory(restored.useEpisodePlaybackStore.getState().progress, 'fanjiao')).toHaveLength(1);
    });
});
