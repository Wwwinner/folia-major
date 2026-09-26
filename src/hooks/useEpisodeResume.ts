import { useEffect, useRef, useState } from 'react';
import type { SongResult } from '../types';
import { getEpisodeKey } from '../utils/episodePlayback';
import { loadEpisodeAlbumQueue } from '../services/episodeAlbumQueue';
import { useEpisodePlaybackStore } from '../stores/useEpisodePlaybackStore';

// 只把选中的分集交给播放入口，续播位置仍由共享收听记录决定。
export function useEpisodeResume(providerId: string, onPlay: (song: SongResult, queue: SongResult[]) => void) {
    const request = useRef<AbortController | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [playFailed, setPlayFailed] = useState(false);
    useEffect(() => () => { request.current?.abort(); request.current = null; }, [providerId]);
    const resume = async (song: SongResult) => {
        if (request.current) return;
        const key = getEpisodeKey(song);
        if (!key || !key.startsWith(`online:${providerId}:`)) return;
        const controller = new AbortController(); request.current = controller;
        setBusy(key); setPlayFailed(false);
        try {
            const queue = await loadEpisodeAlbumQueue({ providerId, id: song.album.id, name: song.album.name, type: 'album' }, controller.signal);
            if (controller.signal.aborted) return;
            const target = queue.find(track => getEpisodeKey(track) === key);
            if (!target) throw new Error('Episode is no longer in the album');
            useEpisodePlaybackStore.getState().hydrateMetadata(queue);
            onPlay(target, queue);
        } catch { if (!controller.signal.aborted) setPlayFailed(true); }
        finally {
            if (request.current === controller) { request.current = null; setBusy(null); }
        }
    };
    return { busy, playFailed, resume };
}
