import { afterEach, describe, expect, it, vi } from 'vitest';
import { fanjiaoProvider, normalizeFanjiaoEpisode } from '../../../src/services/onlineMusic/fanjiaoProvider';
import { omni } from '../../../src/services/onlineMusic/omni';
import { useSearchNavigationStore } from '../../../src/stores/useSearchNavigationStore';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';

// 验证专辑搜索与分集身份经过 Omni，避免把一整部剧当成歌曲。
afterEach(() => { vi.unstubAllGlobals(); useSearchNavigationStore.getState().resetRuntime('netease');
    useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' }); });
describe('Fanjiao Omni adapter', () => {
    it('routes homepage banners through Omni without mistaking banner artwork for the album cover', async () => {
        const fanjiaoRequest = vi.fn(async () => ({ ok: true, data: { items: [{ id: 'banner-section', kind: 'banners', title: 'Banner', items: [],
            banners: [{ id: '4205', title: 'Drama campaign', imageUrl: 'https://example.com/banner.png', album: { id: '111734', name: 'Drama', coverUrl: '' } }] }],
            hasMore: false, nextOffset: 20 } }));
        vi.stubGlobal('window', { electron: { fanjiaoRequest } });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'fanjiao' });
        const section = (await omni.getHomeSections()).items[0];
        expect(section.banners?.[0]).toMatchObject({ id: '4205', imageUrl: 'https://example.com/banner.png',
            album: { id: '111734', providerId: 'fanjiao', type: 'album', coverUrl: '' } });
        expect(fanjiaoRequest).toHaveBeenCalledWith('homeSections', { limit: 20, offset: 0 });
    });
    it('preserves chart identity, ranks and unknown totals through homepage and section calls', async () => {
        const ranking = { position: 21, metric: 'feeding', value: 0 };
        const album = { id: '7', name: 'Drama', ranking };
        const fanjiaoRequest = vi.fn(async (operation: string) => ({ ok: true, data: operation === 'homeSections'
            ? { items: [{ id: 'chart-2', title: '投喂榜', kind: 'ranking', moreId: 'ranking-feeding', items: [album] }], hasMore: false, nextOffset: 20 }
            : { items: [album], hasMore: true, nextOffset: 40 } }));
        vi.stubGlobal('window', { electron: { fanjiaoRequest } });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'fanjiao' });
        expect((await omni.getHomeSections()).items[0]).toMatchObject({ kind: 'ranking', moreId: 'ranking-feeding', items: [{ ranking }] });
        const page = await omni.getDiscoverySectionCollections('ranking-feeding', { limit: 20, offset: 20 });
        expect(page).toMatchObject({ hasMore: true, nextOffset: 40, items: [{ id: '7', providerId: 'fanjiao', ranking }] });
        expect(page.total).toBeUndefined();
        expect(fanjiaoRequest).toHaveBeenLastCalledWith('sectionAlbums', { id: 'ranking-feeding', limit: 20, offset: 20 });
    });
    it.each(['popular', 'discounts'])('routes the %s section page and retains descriptive album metadata', async sectionId => {
        const fanjiaoRequest = vi.fn(async () => ({ ok: true, data: { items: [{ id: '7', name: 'Drama',
            posterUrl: 'https://example.com/poster.png', latestEpisodeName: 'Episode 3', promotionLabel: 'Presale', playCount: 215870 }],
            total: 208, hasMore: true, nextOffset: 40 } }));
        vi.stubGlobal('window', { electron: { fanjiaoRequest } });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'fanjiao' });
        const page = await omni.getDiscoverySectionCollections(sectionId, { limit: 20, offset: 20 });
        expect(fanjiaoRequest).toHaveBeenCalledWith('sectionAlbums', { id: sectionId, limit: 20, offset: 20 });
        expect(page).toMatchObject({ total: 208, hasMore: true, nextOffset: 40, items: [{ id: '7', type: 'album', providerId: 'fanjiao',
            posterUrl: 'https://example.com/poster.png', latestEpisodeName: 'Episode 3', promotionLabel: 'Presale', playCount: 215870 }] });
    });
    it('routes anonymous sections and browse results through Omni with album identity', async () => {
        const album = { id: '7', name: 'Drama', author: '', publisher: '', coverUrl: '', description: '', landscapeCoverUrl: 'https://example.com/landscape.png' };
        const fanjiaoRequest = vi.fn(async (operation: string) => ({ ok: true, data: operation === 'homeSections'
            ? { items: [{ id: 'section-1', title: '精品周更', kind: 'albums', layout: 'landscape-grid', items: [album] }], hasMore: true, nextOffset: 20 }
            : { items: [album], hasMore: false, nextOffset: 24 } }));
        vi.stubGlobal('window', { electron: { fanjiaoRequest } });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'fanjiao' });
        const page = await omni.getHomeSections();
        expect(page.items[0].layout).toBe('landscape-grid');
        expect(page.items[0].items[0]).toMatchObject({ id: '7', providerId: 'fanjiao', type: 'album', landscapeCoverUrl: 'https://example.com/landscape.png' });
        const browse = await omni.browseCollections({ completion: '2' });
        expect(browse.items[0]).toMatchObject({ id: '7', providerId: 'fanjiao', type: 'album' });
        expect(fanjiaoRequest).toHaveBeenLastCalledWith('browseAlbums', { completion: '2', limit: 24, offset: 0 });
        expect(omni.getProviderCapabilities('fanjiao').publicDiscovery).toBe(true);
    });
    it('discards a discovery response after switching providers', async () => {
        let resolve!: (value: unknown) => void;
        vi.stubGlobal('window', { electron: { fanjiaoRequest: () => new Promise(done => { resolve = done; }) } });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'fanjiao' });
        const pending = omni.getHomeSections();
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        resolve({ ok: true, data: { items: [], hasMore: false, nextOffset: 20 } });
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
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
