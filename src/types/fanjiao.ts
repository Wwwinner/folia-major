import type { CollectionBrowseFilter, CollectionRanking, HomeDiscoverySection, ProviderAudioSource, ProviderLyricsResult, ProviderPage } from './onlineMusic';

// 饭角主进程白名单 DTO；临时媒体授权不属于 renderer 合同。
export interface FanjiaoAlbum {
    id: string;
    name: string;
    coverUrl: string;
    description: string;
    author: string;
    publisher: string;
    playCount?: number;
    posterUrl?: string;
    landscapeCoverUrl?: string;
    latestEpisodeName?: string;
    promotionLabel?: string;
    ranking?: CollectionRanking;
}

export interface FanjiaoEpisode {
    isPositive?: 1 | 2 | null;
    playCount?: number;
    id: string;
    albumId: string;
    name: string;
    durationMs: number;
    albumName: string;
    coverUrl: string;
    author: string;
}

export interface FanjiaoResponses {
    homeSections: ProviderPage<HomeDiscoverySection<FanjiaoAlbum>>;
    sectionAlbums: ProviderPage<FanjiaoAlbum>;
    browseFilters: CollectionBrowseFilter[];
    browseAlbums: ProviderPage<FanjiaoAlbum>;
    searchAlbums: ProviderPage<FanjiaoAlbum>;
    album: FanjiaoAlbum;
    episodes: FanjiaoEpisode[];
    episode: FanjiaoEpisode;
    audioSource: ProviderAudioSource;
    lyrics: ProviderLyricsResult;
}
export type FanjiaoOperation = keyof FanjiaoResponses;
export type FanjiaoResponse<T> = { ok: true; data: T }
    | { ok: false; code: 'not-playable' | 'unavailable' | 'network'; message: string };
