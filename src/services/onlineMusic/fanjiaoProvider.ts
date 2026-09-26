import type { SongResult, UnifiedSong } from '../../types';
import type { FanjiaoAlbum, FanjiaoEpisode, FanjiaoOperation, FanjiaoResponses } from '../../types/fanjiao';
import { OnlineProviderError, type OnlineMusicProvider, type ProviderCollection } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// 饭角适配器仅通过 Electron transport 取数据；对 UI 暴露 Omni 专辑、分集和句级字幕。
async function request<T extends FanjiaoOperation>(operation: T,
    params?: Record<string, string | number | boolean | undefined>): Promise<FanjiaoResponses[T]> {
    if (!window.electron?.fanjiaoRequest) throw new OnlineProviderError('unavailable', '饭角需要桌面端运行', 'fanjiao');
    const response = await window.electron.fanjiaoRequest(operation, params);
    if (!response.ok) throw new OnlineProviderError(response.code, response.message, 'fanjiao');
    return response.data;
}

export function normalizeFanjiaoAlbum(raw: FanjiaoAlbum): ProviderCollection {
    return { providerId: 'fanjiao', id: raw.id, name: raw.name, type: 'album',
        coverUrl: raw.coverUrl, description: raw.description, publisher: raw.publisher, playCount: raw.playCount,
        posterUrl: raw.posterUrl, landscapeCoverUrl: raw.landscapeCoverUrl, latestEpisodeName: raw.latestEpisodeName, promotionLabel: raw.promotionLabel, ranking: raw.ranking,
        artists: raw.author ? [{ id: `author:${raw.author}`, name: raw.author }] : [] };
}

export function normalizeFanjiaoEpisode(raw: FanjiaoEpisode): UnifiedSong {
    return { id: raw.id, name: raw.name,
        episode: { kind: raw.isPositive === 1 ? 'main' : raw.isPositive === 2 ? 'extra' : 'unknown',
            playCount: raw.playCount },
        sourceRef: { kind: 'online', providerId: 'fanjiao', mediaId: raw.id },
        artists: raw.author ? [{ id: `author:${raw.author}`, name: raw.author }] : [],
        album: { id: raw.albumId, name: raw.albumName, coverUrl: raw.coverUrl,
            catalogRef: { providerId: 'fanjiao', kind: 'album', id: raw.albumId } },
        durationMs: raw.durationMs };
}

const idOf = (song: SongResult) => {
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online' || source.providerId !== 'fanjiao') throw new OnlineProviderError('unsupported', 'Invalid Fanjiao song', 'fanjiao');
    return source.mediaId;
};

export const fanjiaoProvider: OnlineMusicProvider = {
    id: 'fanjiao', displayName: '饭角', shortName: '饭角',
    getAvailability: () => typeof window !== 'undefined' && !!window.electron?.fanjiaoRequest
        ? { configured: true } : { configured: false, reason: 'runtime-unavailable' },
    capabilities: { search: false, albumSearch: true, playback: true, lyrics: true, auth: false,
        userLibrary: false, playlists: false, albums: true, artists: false, recommendations: false,
        mutations: false, wordByWordLyrics: false, alternativeLyrics: false, publicDiscovery: true },
    normalizeSong: raw => normalizeFanjiaoEpisode(raw as FanjiaoEpisode),
    search: {
        searchSongs: async () => { throw new OnlineProviderError('unsupported', '饭角支持专辑搜索', 'fanjiao'); },
        searchAlbums: async (query, limit, offset) => {
            const page = await request('searchAlbums', { query, limit, offset });
            return { ...page, items: page.items.map(normalizeFanjiaoAlbum) };
        },
    },
    catalog: {
        getAlbumDetail: async id => normalizeFanjiaoAlbum(await request('album', { id: String(id) })),
        getAlbumTracks: async (id, limit = 100, offset = 0) => {
            const episodes = await request('episodes', { id: String(id) });
            const items = episodes.slice(offset, offset + limit).map(normalizeFanjiaoEpisode);
            return { items, total: episodes.length, hasMore: offset + items.length < episodes.length, nextOffset: offset + items.length };
        },
    },
    discovery: {
        getSectionCollections: async (id, limit, offset) => {
            const page = await request('sectionAlbums', { id, limit, offset });
            return { ...page, items: page.items.map(normalizeFanjiaoAlbum) };
        },
        getHomeSections: async (limit, offset) => {
            const page = await request('homeSections', { limit, offset });
            return { ...page, items: page.items.map(section => ({ ...section, items: section.items.map(normalizeFanjiaoAlbum),
                banners: section.banners?.map(banner => ({ ...banner, album: normalizeFanjiaoAlbum(banner.album) })) })) };
        },
        getBrowseFilters: () => request('browseFilters'),
        browseCollections: async (query, limit, offset) => {
            const page = await request('browseAlbums', { ...query, limit, offset });
            return { ...page, items: page.items.map(normalizeFanjiaoAlbum) };
        },
    },
    playback: {
        getSongDetail: async id => normalizeFanjiaoEpisode(await request('episode', { id: String(id) })),
        getAudioSource: (song, quality) => request('audioSource', { id: idOf(song), quality }),
        getAvailability: () => ({ state: 'unknown' }),
    },
    lyrics: { getLyrics: song => request('lyrics', { id: idOf(song) }) },
};
