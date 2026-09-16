import { afterEach, describe, expect, it, vi } from 'vitest';
import { fanjiaoProvider, normalizeFanjiaoEpisode } from '../../../src/services/onlineMusic/fanjiaoProvider';
import { omni } from '../../../src/services/onlineMusic/omni';
import { useSearchNavigationStore } from '../../../src/stores/useSearchNavigationStore';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';

// 验证专辑搜索与分集身份经过 Omni，避免把一整部剧当成歌曲。
afterEach(() => { vi.unstubAllGlobals(); useSearchNavigationStore.getState().resetRuntime('netease'); });
describe('Fanjiao Omni adapter', () => {
    it('routes album search and caches/restores collection results without fake tracks', async () => {
        const fanjiaoRequest = vi.fn(async () => ({ ok: true, data: { items: [{ id: '111726', name: '冬日花火', author: '闵然' }],
            hasMore: false, total: 1, nextOffset: 30 } }));
        vi.stubGlobal('window', { electron: { fanjiaoRequest } });
        await useSearchNavigationStore.getState().submitSearch({ query: '冬日花火', sourceTab: 'fanjiao', deps: { localSongs: [], t: key => key } });
        const state = useSearchNavigationStore.getState();
        expect(state.searchError).toBeNull();
        expect(state.searchResults).toEqual([]);
        expect(state.searchAlbums).toMatchObject([{ type: 'album', providerId: 'fanjiao', id: '111726' }]);
        state.restoreSearch({ query: '冬日花火', sourceTab: 'fanjiao' });
        expect(useSearchNavigationStore.getState().searchAlbums).toHaveLength(1);
        expect(fanjiaoRequest).toHaveBeenCalledWith('searchAlbums', { query: '冬日花火', limit: 30, offset: 0 });
        expect(omni.getProviderSummaries().find(provider => provider.providerId === 'fanjiao')).toMatchObject({ status: 'anonymous', hydration: 'ready' });
    });
    it('normalizes episode IDs, album links and millisecond durations', () => {
        const song = normalizeFanjiaoEpisode({ id: '120361', albumId: '111726', name: 'Episode', durationMs: 47000,
            albumName: 'Album', coverUrl: '', author: 'Author', isPositive: 1, playCount: 28177 });
        expect(getPlaybackSongKey(song)).toBe('online:fanjiao:120361');
        expect(song.album.catalogRef).toEqual({ kind: 'album', providerId: 'fanjiao', id: '111726' });
        expect(song.durationMs).toBe(47000);
        expect(song.episode).toEqual({ kind: 'main', playCount: 28177 });
        expect(fanjiaoProvider.capabilities.alternativeLyrics).toBe(false);
    });
});
