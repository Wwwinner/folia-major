import type { SongResult } from '../types';
import type { OmniCollection } from '../types/onlineMusic';
import { getEpisodeKey, validEpisodeProgress, type EpisodeHistoryMetadata, type EpisodeProgress } from './episodePlayback';

// 收听记录只缓存展示和目录身份，不保存媒体 URL、授权或完整 provider 响应。
export const getEpisodeHistoryTime = (progress: EpisodeProgress) => progress.lastPlayedAt ?? progress.updatedAt;

export function normalizeEpisodeMetadata(value: unknown): EpisodeHistoryMetadata | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Partial<EpisodeHistoryMetadata>;
    if (typeof raw.albumId !== 'string' || !raw.albumId || typeof raw.albumName !== 'string' || typeof raw.name !== 'string') return undefined;
    let coverUrl = '';
    try {
        const url = new URL(raw.coverUrl || '');
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) coverUrl = url.href;
    } catch { /* 无效封面保留记录，由界面显示已有占位图。 */ }
    return { name: raw.name, albumId: raw.albumId, albumName: raw.albumName, coverUrl,
        author: typeof raw.author === 'string' ? raw.author : '',
        kind: raw.kind === 'main' || raw.kind === 'extra' ? raw.kind : 'unknown' };
}

export function episodeMetadataFromSong(song: SongResult): EpisodeHistoryMetadata | undefined {
    if (!getEpisodeKey(song) || song.album.id === undefined || song.album.id === null) return undefined;
    return normalizeEpisodeMetadata({ name: song.name, albumId: String(song.album.id), albumName: song.album.name,
        coverUrl: song.album.coverUrl || '', author: song.artists.map(artist => artist.name).join(' / '), kind: song.episode?.kind });
}

export function normalizeEpisodeProgress(value: unknown): EpisodeProgress | null {
    if (!validEpisodeProgress(value)) return null;
    const result: EpisodeProgress = { position: value.position, duration: value.duration, completed: value.completed, updatedAt: value.updatedAt };
    if (value.lastPlayedAt !== undefined) result.lastPlayedAt = value.lastPlayedAt;
    const metadata = normalizeEpisodeMetadata(value.metadata);
    if (metadata) result.metadata = metadata;
    return result;
}

export function episodeSongFromProgress(key: string, progress: EpisodeProgress): SongResult | null {
    const source = /^online:([^:]+):(.+)$/.exec(key);
    const metadata = normalizeEpisodeMetadata(progress.metadata);
    if (!source || !metadata) return null;
    const [, providerId, id] = source;
    return { id, name: metadata.name, sourceRef: { kind: 'online', providerId, mediaId: id },
        artists: metadata.author ? [{ id: `author:${metadata.author}`, name: metadata.author }] : [],
        album: { id: metadata.albumId, name: metadata.albumName, coverUrl: metadata.coverUrl,
            catalogRef: { kind: 'album', providerId, id: metadata.albumId } },
        durationMs: progress.duration * 1000, episode: { kind: metadata.kind } };
}

export interface EpisodeHistoryRecord { key: string; song: SongResult; progress: EpisodeProgress; time: number; }
export interface EpisodeHistoryAlbum { key: string; album: OmniCollection; latest: EpisodeHistoryRecord; episodes: EpisodeHistoryRecord[]; }

export function groupEpisodeHistory(progress: Record<string, EpisodeProgress>, providerId: string): EpisodeHistoryAlbum[] {
    const groups = new Map<string, EpisodeHistoryAlbum>();
    Object.entries(progress).filter(([key, value]) => key.startsWith(`online:${providerId}:`) && getEpisodeHistoryTime(value) > 0)
        .sort((a, b) => getEpisodeHistoryTime(b[1]) - getEpisodeHistoryTime(a[1])).forEach(([key, value]) => {
            const song = episodeSongFromProgress(key, value);
            if (!song) return;
            const albumKey = `${providerId}:${song.album.id}`;
            const record = { key, song, progress: value, time: getEpisodeHistoryTime(value) };
            const group = groups.get(albumKey);
            if (group) group.episodes.push(record);
            else groups.set(albumKey, { key: albumKey, album: { providerId, id: song.album.id, name: song.album.name,
                coverUrl: song.album.coverUrl, type: 'album' }, latest: record, episodes: [record] });
        });
    return [...groups.values()];
}

export function episodeHistoryDay(timestamp: number, now = Date.now()): 'today' | 'yesterday' | 'earlier' {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    return timestamp >= today.getTime() ? 'today' : timestamp >= yesterday.getTime() ? 'yesterday' : 'earlier';
}
