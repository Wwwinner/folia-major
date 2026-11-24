import type { FoliumClientApi, FoliumSourceCollection, FoliumSourceDef, FoliumSourceExternalPlayback, FoliumSourceNamedRef, FoliumSourceSong } from '@folia/folium';
import type {
    FanjiaoAlbum, FanjiaoEpisode, FanjiaoRecommendation, FanjiaoRequest, FanjiaoRpcResponse,
    FanjiaoResponses,
} from '../contracts';

// 将饭角公开目录交给 Folium；媒体地址只由音源自己的播放器读取。
export function createFanjiaoRequest(folium: FoliumClientApi): FanjiaoRequest {
    return async <K extends keyof FanjiaoResponses>(operation: K, params = {}) => {
        const response = await folium.rpc.call<FanjiaoRpcResponse<FanjiaoResponses[K]>>('fanjiao', operation, params);
        if (response.ok) return response.data;
        if (response.code === 'not-configured') {
            throw folium.sources.error('unavailable', folium.i18n.text('notConfigured'));
        }
        if (response.code === 'not-playable') {
            throw folium.sources.error('not-playable', folium.i18n.text('notPlayable'));
        }
        throw folium.sources.error(response.code === 'invalid' ? 'invalid-response' : 'network', folium.i18n.text('requestFailed'));
    };
}

const authors = (name: string): FoliumSourceNamedRef[] => name ? [{ id: name, name, ref: false }] : [];
const collectionOf = (album: FanjiaoAlbum): FoliumSourceCollection => ({
    id: album.id,
    type: 'album',
    name: album.name,
    coverUrl: album.coverUrl,
    coverVariants: album.coverVariants,
    description: album.description,
    publisher: album.publisher,
    artists: authors(album.author),
    playCount: album.playCount,
});

const recommendationCollectionOf = (item: FanjiaoRecommendation): FoliumSourceCollection => (
    'kind' in item ? {
        id: item.id,
        type: 'playlist',
        name: item.name,
        coverUrl: item.coverUrl,
        coverVariants: item.coverVariants,
        playlistContents: item.playlistContents,
    } : collectionOf(item)
);

const songOf = (episode: FanjiaoEpisode): FoliumSourceSong => ({
    id: episode.id,
    title: episode.name,
    artists: authors(episode.author),
    album: { id: episode.albumId, name: episode.albumName, coverUrl: episode.coverUrl },
    durationMs: episode.durationMs,
    kind: 'episode',
    ...(episode.playCount === undefined ? {} : { row: { listenCount: episode.playCount } }),
});

export function createFanjiaoSource(
    folium: FoliumClientApi,
    request: FanjiaoRequest,
    player: FoliumSourceExternalPlayback,
    configured: () => boolean,
): FoliumSourceDef {
    const notConfigured = { configured: false, reason: 'not-configured', message: folium.i18n.key('notConfigured') } as const;
    const available = { configured: true } as const;
    return {
        id: 'fanjiao',
        displayName: folium.i18n.key('sourceName'),
        getAvailability: () => configured() ? available : notConfigured,
        describeFailure: () => configured() ? null : { case: 'not-configured', message: folium.i18n.text('notConfigured') },
        itemKinds: { episode: { lyrics: 'own', likable: false, reported: false } },
        capabilities: {
            'search@1': {
                supportsSongs: false,
                searchSongs: () => Promise.resolve({ items: [], total: 0, hasMore: false }),
                async searchAlbums(query, limit, offset) {
                    const page = await request('searchAlbums', { query, limit, offset });
                    return { ...page, items: page.items.map(collectionOf) };
                },
            },
            'songs@1': { getSong: async id => songOf(await request('episode', { id })) },
            'catalog@1': {
                getAlbumDetail: async id => collectionOf(await request('album', { id })),
                async getAlbumTracks(id, limit = 100, offset = 0) {
                    const episodes = await request('episodes', { id });
                    const items = episodes.slice(offset, offset + limit).map(songOf);
                    return { items, total: episodes.length, hasMore: offset + items.length < episodes.length };
                },
                async getPlaylistAlbums(id, limit, offset) {
                    const page = await request('playlistAlbums', { id, limit, offset });
                    return { ...page, items: page.items.map(collectionOf) };
                },
            },
            'recommendations@1': {
                async getRecommendedCollections(limit) {
                    return (await request('recommendations', { limit })).map(recommendationCollectionOf);
                },
            },
            'playback.external@1': player,
            'lyrics@1': { getLyrics: song => request('lyrics', { id: song.id }) },
        },
    };
}
