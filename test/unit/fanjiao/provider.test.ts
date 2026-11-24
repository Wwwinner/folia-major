// @builtin-sources
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { itemTraits } from '@/services/onlineMusic/itemTraits';
import { toFoliumSong } from '@/mods/folium/dto';
import { emitFoliumEvent } from '@/mods/folium/events';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';
import type { FanjiaoAlbum, FanjiaoEpisode, FanjiaoPlaylist } from '../../../sources/fanjiao/contracts';
import { setBuiltinSourceRpc } from '../helpers/builtinSources';

// 驱动宿主的 Omni 与音源适配器，仅替换上游响应和本测试环境无法播放的媒体。
vi.mock('hls.js', () => ({ default: class {
    static isSupported = () => true;
    static Events = { ERROR: 'error' };
    constructor(private readonly config: { startPosition: number }) {}
    on() {}
    loadSource() {}
    destroy() {}
    attachMedia(audio: { currentTime: number }) { audio.currentTime = this.config.startPosition; }
} }));

class TestAudio extends EventTarget {
    currentTime = 0;
    paused = true;
    play() {
        if (this.paused) { this.paused = false; this.dispatchEvent(new Event('playing')); }
        return Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
}

const activeTokens = new Set<string>();
let issuance = 0;
let nextAudio: Promise<void> | undefined;
let failReopen = false;
const provider = 'fanjiao';
const album: FanjiaoAlbum = {
    id: '20', name: '冬日花火', author: 'Studio', publisher: '', description: '', coverUrl: '',
    coverVariants: { landscape: 'https://example.com/wide.png', portrait: 'https://example.com/tall.png', square: 'https://example.com/square.png' },
};
const recommended: FanjiaoAlbum = { ...album, id: '21', name: '夏日花火' };
const popularPlaylist: FanjiaoPlaylist = {
    kind: 'playlist', id: 'featured:popular', name: '热门速递',
    coverUrl: 'https://example.com/popular.png', playlistContents: 'albums',
    coverVariants: album.coverVariants,
};
const weeklyPlaylist: FanjiaoPlaylist = {
    kind: 'playlist', id: 'featured:weekly', name: '精品周更',
    coverUrl: 'https://example.com/weekly.png', playlistContents: 'albums',
};
let failRecommendations = false;
let includePlaylists = false;
const episodes: FanjiaoEpisode[] = ['103', '99', '101'].map((id) => ({
    id, name: `剧集 ${id}`, durationMs: 20_000, author: album.author,
    albumId: album.id, albumName: album.name, coverUrl: album.coverUrl,
}));
const unbind = setBuiltinSourceRpc(provider, {
    async fanjiao(operation, params) {
        if (operation === 'status') return { ok: true, data: { configured: true } };
        if (operation === 'searchAlbums') return { ok: true, data: { items: [album], total: 1, hasMore: false, nextOffset: 20 } };
        if (operation === 'recommendations') {
            const items = includePlaylists ? [popularPlaylist, weeklyPlaylist, album, recommended] : [album, recommended];
            return failRecommendations ? { ok: false, code: 'network' } : { ok: true, data: items };
        }
        if (operation === 'playlistAlbums') {
            const page = params as { id?: string; limit?: number; offset?: number };
            if (page.id !== popularPlaylist.id) return { ok: false, code: 'invalid' };
            const all = [album, recommended];
            const offset = page.offset ?? 0;
            const limit = page.limit ?? 20;
            const items = all.slice(offset, offset + limit);
            return { ok: true, data: { items, total: all.length, hasMore: offset + items.length < all.length,
                nextOffset: offset + items.length } };
        }
        if (operation === 'album') return { ok: true, data: album };
        if (operation === 'episodes') return { ok: true, data: episodes };
        const values = params as { id?: string; token?: string } | undefined;
        if (operation === 'audioSource') {
            const token = `${values?.id}-${++issuance}`;
            if (failReopen) { failReopen = false; return { ok: false, code: 'network' }; }
            await nextAudio;
            activeTokens.add(token);
            return { ok: true, data: { token, url: `folia-mod://fanjiao/_media/${token}` } };
        }
        if (operation === 'hasAudio') return { ok: true, data: activeTokens.has(values?.token ?? '') };
        if (operation === 'closeAudio') { activeTokens.delete(values?.token ?? ''); return { ok: true, data: null }; }
        throw new Error(`Unexpected Fanjiao operation: ${String(operation)}`);
    },
});
afterAll(unbind);
afterEach(() => {
    failRecommendations = false;
    includePlaylists = false;
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease', chosenProviderId: 'netease' });
    omni.invalidateActiveRequests();
});

describe('饭角经 Omni 的原生目录', () => {
    it('从原生搜索回车直接搜专辑，并能恢复旧的单曲搜索记录', async () => {
        const previous = useSearchNavigationStore.getState();
        const deps = { localSongs: [], t: (key: string) => key };
        const search = { query: '冬日花火', sourceTab: provider };
        try {
            useSearchNavigationStore.setState({ searchKind: 'song' });
            await expect(previous.submitSearch({ ...search, deps })).resolves.toBe(true);
            expect(useSearchNavigationStore.getState().collectionResults).toMatchObject([{ id: album.id, type: 'album' }]);
            previous.restoreSearch({ ...search, kind: 'song' });
            expect(useSearchNavigationStore.getState()).toMatchObject({
                searchKind: 'album', collectionResults: [{ id: album.id, type: 'album' }],
            });
        } finally {
            useSearchNavigationStore.setState(previous);
        }
    });

    it('不造歌曲结果，以官方分集顺序分页播放和读自己的字幕', async () => {
        const page = { limit: 20, offset: 0 };
        const albums = await omni.searchProviderCollections(provider, 'album', '冬日花火', page);
        expect(albums.items).toMatchObject([{ type: 'album', providerId: provider, id: album.id }]);
        expect((await omni.searchProviderSongs(provider, '冬日花火', page)).items).toEqual([]);
        const first = await omni.getCollectionTracks(albums.items[0], { limit: 2, offset: 0 });
        expect(first.items.map(song => song.id)).toEqual(['103', '99']);
        expect(first).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });
        const last = await omni.getCollectionTracks(albums.items[0], { limit: 2, offset: first.nextOffset });
        expect(last.items.map(song => song.id)).toEqual(['101']);
        expect(last.hasMore).toBe(false);
        expect(itemTraits(last.items[0])).toEqual({ kind: 'episode', lyrics: 'own', likable: false, reported: false, route: 'external' });
    });

    it('把推荐作为专辑集合交给首页，并能沿目录继续打开分集', async () => {
        useOnlineProviderAccountStore.getState().setActiveProviderId(provider);
        const feed = await omni.getHomeFeed(2);
        expect(feed).toMatchObject({
            personalFm: [], dailySongs: [],
            recommendedCollections: [
                { type: 'album', providerId: provider, id: album.id, name: album.name },
                { type: 'album', providerId: provider, id: recommended.id, name: recommended.name },
            ],
        });
        expect(feed.partial).toBeUndefined();
        const tracks = await omni.getCollectionTracks(feed.recommendedCollections[0], { limit: 20, offset: 0 });
        expect(tracks.items.map(song => song.id)).toEqual(['103', '99', '101']);
        expect(tracks.items.every(song => song.sourceRef.kind === 'online' && song.sourceRef.providerId === provider)).toBe(true);
    });

    it('把两个官方播放列表交给首页，打开时只按专辑页读取', async () => {
        includePlaylists = true;
        useOnlineProviderAccountStore.getState().setActiveProviderId(provider);
        const feed = await omni.getHomeFeed();
        expect(feed.recommendedCollections.slice(0, 2)).toMatchObject([
            { type: 'playlist', providerId: provider, id: popularPlaylist.id, playlistContents: 'albums', coverVariants: popularPlaylist.coverVariants },
            { type: 'playlist', providerId: provider, id: weeklyPlaylist.id, playlistContents: 'albums' },
        ]);
        expect(feed.recommendedCollections[0]).not.toHaveProperty('trackCount');
        expect(feed.recommendedCollections.slice(2)).toMatchObject([
            { type: 'album', providerId: provider, id: album.id, coverVariants: album.coverVariants },
            { type: 'album', providerId: provider, id: recommended.id },
        ]);
        const first = await omni.getPlaylistAlbums(feed.recommendedCollections[0], { limit: 1, offset: 0 });
        expect(first).toMatchObject({ total: 2, hasMore: true, nextOffset: 1 });
        expect(first.items).toMatchObject([{ type: 'album', providerId: provider, id: album.id, coverVariants: album.coverVariants }]);
        const rest = await omni.getPlaylistAlbums(feed.recommendedCollections[0], { limit: 1, offset: first.nextOffset });
        expect(rest.items.map(item => item.id)).toEqual([recommended.id]);
        expect(rest.hasMore).toBe(false);
    });

    it('推荐是唯一支持的部分时，其失败不能伪装成空推荐页', async () => {
        failRecommendations = true;
        useOnlineProviderAccountStore.getState().setActiveProviderId(provider);
        await expect(omni.getHomeFeed(2)).rejects.toMatchObject({ code: 'network' });
    });

    it('重开失败后仍可续播，重复播放指令和旧集字幕不打断时钟', async () => {
        vi.stubGlobal('Audio', TestAudio);
        let resolve!: () => void;
        const promise = new Promise<void>(complete => { resolve = complete; });
        try {
            const albums = await omni.searchProviderCollections(provider, 'album', '冬日花火', { limit: 20, offset: 0 });
            const { items: [first, second] } = await omni.getCollectionTracks(albums.items[0], { limit: 2, offset: 0 });
            await omni.playSongExternally(first);
            emitFoliumEvent('playback.songChanged', { song: toFoliumSong(first) });
            await omni.seekExternalPlayback(first, 12);
            await omni.pauseExternalPlayback(first);
            activeTokens.clear();
            failReopen = true;
            await expect(omni.resumeExternalPlayback(first)).rejects.toMatchObject({ code: 'network' });
            await omni.resumeExternalPlayback(first);
            expect(await omni.getExternalPlaybackStatus(first)).toMatchObject({ mediaId: first.id, isPlaying: true, positionMs: 12000 });
            await omni.resumeExternalPlayback(first);
            expect(await omni.getExternalPlaybackStatus(first)).toMatchObject({ mediaId: first.id, isPlaying: true, positionMs: 12000 });
            expect(issuance).toBe(3);

            nextAudio = promise;
            const starting = omni.playSongExternally(second);
            await vi.waitFor(() => expect(issuance).toBe(4));
            emitFoliumEvent('playback.songChanged', { song: toFoliumSong({ ...first }) });
            resolve();
            await starting;
            expect(await omni.getExternalPlaybackStatus(second)).toMatchObject({ mediaId: second.id, isPlaying: true });
        } finally {
            resolve();
            nextAudio = undefined;
            failReopen = false;
            emitFoliumEvent('playback.songChanged', { song: null });
            vi.unstubAllGlobals();
        }
    });

    it('首播网络失败后，手动重播同一集从零开始', async () => {
        vi.stubGlobal('Audio', TestAudio);
        try {
            const albums = await omni.searchProviderCollections(provider, 'album', '冬日花火', { limit: 20, offset: 0 });
            const { items: [first] } = await omni.getCollectionTracks(albums.items[0], { limit: 1, offset: 0 });
            failReopen = true;
            await expect(omni.playSongExternally(first, 12)).rejects.toMatchObject({ code: 'network' });
            await omni.playSongExternally(first);
            emitFoliumEvent('playback.songChanged', { song: toFoliumSong(first) });
            expect(await omni.getExternalPlaybackStatus(first)).toMatchObject({ mediaId: first.id, positionMs: 0, isPlaying: true });
        } finally {
            emitFoliumEvent('playback.songChanged', { song: null });
            vi.unstubAllGlobals();
        }
    });
});
