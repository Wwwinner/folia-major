import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OmniCollection } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';
import { useEpisodePlaybackStore } from '../../../stores/useEpisodePlaybackStore';
import { getEpisodeHistoryTime, groupEpisodeHistory } from '../../../utils/episodeHistory';
import { getEpisodeKey } from '../../../utils/episodePlayback';
import { loadEpisodeAlbumQueue } from '../../../services/episodeAlbumQueue';

// 旧进度分批补齐元数据，新记录直接本地展示；补齐过程不改收听时间或播放位置。
export function useEpisodeHistory(providerId: string) {
    const progress = useEpisodePlaybackStore(state => state.progress);
    const [limit, setLimit] = useState(40);
    const [attempt, setAttempt] = useState(0);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [panelLoading, setPanelLoading] = useState(false);
    const [panelFailed, setPanelFailed] = useState(false);
    const panelRequest = useRef<AbortController | null>(null);
    const entries = useMemo(() => Object.entries(progress)
        .filter(([key, value]) => key.startsWith(`online:${providerId}:`) && getEpisodeHistoryTime(value) > 0)
        .sort((a, b) => getEpisodeHistoryTime(b[1]) - getEpisodeHistoryTime(a[1])), [progress, providerId]);
    const keys = JSON.stringify(entries.slice(0, limit).map(([key]) => key));
    const allGroups = useMemo(() => groupEpisodeHistory(progress, providerId), [progress, providerId]);
    const visibleKeys = new Set<string>(JSON.parse(keys));
    const groups = allGroups.filter(group => visibleKeys.has(group.latest.key));

    useEffect(() => {
        let cancelled = false;
        const candidates = (JSON.parse(keys) as string[]).filter(key => !useEpisodePlaybackStore.getState().progress[key]?.metadata);
        setLoading(candidates.length > 0); setFailed(false);
        void (async () => {
            let failures = 0;
            for (let start = 0; start < candidates.length && !cancelled; start += 4) {
                const batch = candidates.slice(start, start + 4).filter(key => !useEpisodePlaybackStore.getState().progress[key]?.metadata);
                const songs = await Promise.all(batch.map(async key => {
                    try {
                        const song = await omni.getSongDetail(providerId, key.slice(`online:${providerId}:`.length));
                        return getEpisodeKey(song) === key ? song : null;
                    } catch { return null; }
                }));
                if (cancelled) return;
                const found = songs.filter(song => song !== null);
                failures += songs.length - found.length;
                useEpisodePlaybackStore.getState().hydrateMetadata(found);
            }
            if (!cancelled) { setLoading(false); setFailed(failures > 0); }
        })();
        return () => { cancelled = true; };
    }, [keys, providerId, attempt]);

    const hydrateAlbum = useCallback(async (album: OmniCollection | null) => {
        panelRequest.current?.abort(); panelRequest.current = null;
        setPanelLoading(false); setPanelFailed(false);
        if (!album || !Object.entries(useEpisodePlaybackStore.getState().progress)
            .some(([key, value]) => key.startsWith(`online:${providerId}:`) && !value.metadata)) return;
        const controller = new AbortController(); panelRequest.current = controller;
        setPanelLoading(true);
        try {
            const queue = await loadEpisodeAlbumQueue(album, controller.signal);
            if (!controller.signal.aborted) useEpisodePlaybackStore.getState().hydrateMetadata(queue);
        } catch { if (!controller.signal.aborted) setPanelFailed(true); }
        finally { if (!controller.signal.aborted) setPanelLoading(false); }
    }, [providerId]);
    useEffect(() => () => { panelRequest.current?.abort(); }, [providerId]);

    return { groups, allGroups, total: entries.length, loading, failed, panelLoading, panelFailed, hydrateAlbum,
        hasMore: entries.length > limit, loadMore: () => setLimit(previous => previous + 40), retry: () => setAttempt(previous => previous + 1) };
}
