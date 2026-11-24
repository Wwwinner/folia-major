import type { FoliumSourceCollection, FoliumSourceLyricsResult } from '@folia/folium';

// 饭角跨进程只传目录 DTO、字幕原文和本地媒体会话；不传上游媒体授权。
export interface FanjiaoAlbum {
    id: string;
    name: string;
    coverUrl: string;
    coverVariants?: FoliumSourceCollection['coverVariants'];
    description: string;
    author: string;
    publisher: string;
    playCount?: number;
}

export interface FanjiaoEpisode {
    id: string;
    albumId: string;
    name: string;
    durationMs: number;
    albumName: string;
    coverUrl: string;
    author: string;
    isPositive?: 1 | 2 | null;
    playCount?: number;
}

/** A named playlist of albums, shown as a native playlist card rather than an episode list. */
export interface FanjiaoPlaylist {
    kind: 'playlist';
    id: string;
    name: string;
    coverUrl: string;
    coverVariants?: FanjiaoAlbum['coverVariants'];
    playlistContents: 'albums';
}

export type FanjiaoRecommendation = FanjiaoAlbum | FanjiaoPlaylist;

export interface FanjiaoPage<T> {
    items: T[];
    total?: number;
    hasMore: boolean;
    nextOffset: number;
}

export type FanjiaoParams = {
    id?: string;
    limit?: number;
    offset?: number;
    query?: string;
    quality?: string;
    token?: string;
};

export interface FanjiaoResponses {
    status: { configured: boolean };
    recommendations: FanjiaoRecommendation[];
    searchAlbums: FanjiaoPage<FanjiaoAlbum>;
    playlistAlbums: FanjiaoPage<FanjiaoAlbum>;
    album: FanjiaoAlbum;
    episodes: FanjiaoEpisode[];
    episode: FanjiaoEpisode;
    lyrics: FoliumSourceLyricsResult | null;
    audioSource: { url: string; token: string };
    hasAudio: boolean;
    closeAudio: null;
}

export type FanjiaoRpcResponse<T> = { ok: true; data: T }
    | { ok: false; code: 'not-configured' | 'not-playable' | 'network' | 'invalid'; message?: string };
export type FanjiaoRequest = <K extends keyof FanjiaoResponses>(operation: K, params?: FanjiaoParams) => Promise<FanjiaoResponses[K]>;

export interface FanjiaoHistoryEntry {
    id: string;
    albumId: string;
    title: string;
    albumTitle: string;
    coverUrl?: string;
    position: number;
    duration: number;
    listenedAt: number;
    completed: boolean;
}
