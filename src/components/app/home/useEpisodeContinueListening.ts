import { useEffect, useMemo, useRef, useState } from 'react';
import type { SongResult } from '../../../types';
import { omni } from '../../../services/onlineMusic/omni';
import { useEpisodePlaybackStore } from '../../../stores/useEpisodePlaybackStore';
import { getEpisodeKey } from '../../../utils/episodePlayback';
import { episodeSongFromProgress, getEpisodeHistoryTime } from '../../../utils/episodeHistory';
import { useEpisodeResume } from '../../../hooks/useEpisodeResume';

// 只按最近分集身份补齐元数据，五秒进度写入不会反复请求；续播仍使用原专辑完整队列。
export function useEpisodeContinueListening(providerId: string, onPlay: (song: SongResult, queue: SongResult[]) => void) {
    const progress = useEpisodePlaybackStore(state => state.progress);
    const prefix = `online:${providerId}:`;
    const keys = useMemo(() => JSON.stringify(Object.entries(progress)
        .filter(([key, value]) => key.startsWith(prefix) && !value.completed && value.position > 0 && getEpisodeHistoryTime(value) > 0)
        .sort((a, b) => getEpisodeHistoryTime(b[1]) - getEpisodeHistoryTime(a[1])).slice(0, 8).map(([key]) => key)), [progress, prefix]);
    const cache = useRef(new Map<string, Promise<SongResult | null>>());
    const [songs, setSongs] = useState<SongResult[]>([]);
    const [attempt, setAttempt] = useState(0);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const playback = useEpisodeResume(providerId, onPlay);
    useEffect(() => {
        let cancelled = false;
        const candidates = JSON.parse(keys) as string[];
        setLoading(candidates.length > 0); setFailed(false);
        Promise.all(candidates.map(key => {
            const saved = useEpisodePlaybackStore.getState().progress[key];
            const local = saved && episodeSongFromProgress(key, saved);
            if (local) return Promise.resolve(local);
            if (!cache.current.has(key)) cache.current.set(key, omni.getSongDetail(providerId, key.slice(prefix.length)).catch(() => null));
            return cache.current.get(key)!;
        })).then(results => {
            if (cancelled) return;
            const found = results.filter((song): song is SongResult => Boolean(song?.episode));
            useEpisodePlaybackStore.getState().hydrateMetadata(found);
            setSongs(found); setLoading(false); setFailed(candidates.length > 0 && !found.length);
        });
        return () => { cancelled = true; };
    }, [keys, providerId, prefix, attempt]);

    const seenAlbums = new Set<string>();
    const items = songs.flatMap(song => {
        const key = getEpisodeKey(song)!;
        const value = progress[key];
        const album = `${providerId}:${song.album.id}`;
        if (!value || value.completed || value.position <= 0 || seenAlbums.has(album)) return [];
        seenAlbums.add(album);
        return [{ song, key, position: value.position }];
    }).slice(0, 6);

    return { items, loading, failed, ...playback,
        retry: () => { cache.current.clear(); setAttempt(value => value + 1); } };
}
