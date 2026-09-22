import type { SongResult } from '../types';
import { getPlaybackSongKey } from './appPlaybackGuards';

// 广播剧队列与进度规则；不根据标题猜分类，也不影响普通音乐队列。
export interface EpisodeHistoryMetadata {
    name: string;
    albumId: string;
    albumName: string;
    coverUrl: string;
    author: string;
    kind: 'main' | 'extra' | 'unknown';
}
export interface EpisodeProgress {
    position: number;
    duration: number;
    completed: boolean;
    updatedAt: number;
    lastPlayedAt?: number;
    metadata?: EpisodeHistoryMetadata;
}
export const getEpisodeKey = (song: SongResult | null | undefined): string | null =>
    song?.episode && song.sourceRef?.kind === 'online' ? getPlaybackSongKey(song) : null;

export function resolveQueueNeighborIndex(tracks: SongResult[], current: SongResult | null, direction: 1 | -1,
    loop: 'off' | 'all' | 'one', mainOnly = false, accept: (song: SongResult) => boolean = () => true): number {
    if (!current || !tracks.length) return -1;
    const key = getPlaybackSongKey(current);
    const anchor = tracks.findIndex(song => getPlaybackSongKey(song) === key);
    // 只改变导航目标，完整队列及其顺序始终保留；普通音乐不应用广播剧筛选。
    const filterMain = mainOnly && Boolean(current.episode);
    if (anchor < 0 && direction === -1 && loop !== 'all') return -1;
    let index = anchor < 0 ? (direction === 1 ? -1 : tracks.length) : anchor;
    for (let step = 0; step < tracks.length; step++) {
        index += direction;
        if (index < 0 || index >= tracks.length) {
            if (loop !== 'all') return -1;
            index = (index + tracks.length) % tracks.length;
        }
        const candidate = tracks[index];
        if ((!filterMain || candidate.episode?.kind === 'main') && accept(candidate)) return index;
    }
    return -1;
}

export function getResumePosition(progress: EpisodeProgress | undefined): number | null {
    if (!progress || progress.completed || progress.position <= 0) return null;
    return Math.min(progress.position, Math.max(0, progress.duration - .25));
}

export function validEpisodeProgress(value: unknown): value is EpisodeProgress {
    if (!value || typeof value !== 'object') return false;
    const p = value as EpisodeProgress;
    return Number.isFinite(p.position) && p.position >= 0 && Number.isFinite(p.duration) && p.duration > 0
        && p.position <= p.duration && typeof p.completed === 'boolean'
        && Number.isFinite(p.updatedAt) && p.updatedAt >= 0
        && (p.lastPlayedAt === undefined || (Number.isFinite(p.lastPlayedAt) && p.lastPlayedAt >= 0));
}
