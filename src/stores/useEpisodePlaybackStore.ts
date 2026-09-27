import { create } from 'zustand';
import type { SongResult } from '../types';
import { getEpisodeKey, getResumePosition, validEpisodeProgress, type EpisodeProgress } from '../utils/episodePlayback';
import { isEpisodeSource } from '../services/playbackMediaSource';
import { episodeMetadataFromSong, getEpisodeHistoryTime, normalizeEpisodeProgress } from '../utils/episodeHistory';
import type { FanjiaoSyncData } from '../../shared/fanjiaoSync.mjs';
import { beginFanjiaoSession, endFanjiaoSession, isFanjiaoSessionHidden, recordFanjiaoProgress, resetFanjiaoEpisode,
    clearFanjiaoHistory, recordFanjiaoPreference, exportFanjiaoData, mergeFanjiaoData, persistFanjiaoOperation, restoreFanjiaoState, hydrateFanjiaoMetadata } from '../services/sync/fanjiaoPlaybackBridge';

// 逐集收听位置属于本机历史；同步写入轻量记录，避免退出时等待异步数据库事务。
export const EPISODE_PROGRESS_STORAGE_KEY = 'folia_episode_progress_v1';
const MAIN_ONLY_KEY = 'folia_main_episodes_only';
const MAX_ENTRIES = 2000;
const pendingRestarts = new Set<string>();
const storage = () => typeof localStorage === 'undefined' ? null : localStorage;
function readProgress(): Record<string, EpisodeProgress> {
    try {
        const raw = JSON.parse(storage()?.getItem(EPISODE_PROGRESS_STORAGE_KEY) || '{}');
        const entries: Array<[string, EpisodeProgress]> = [];
        for (const [key, value] of Object.entries(raw)) {
            const normalized = normalizeEpisodeProgress(value);
            if (key.startsWith('online:') && normalized) entries.push([key, normalized]);
        }
        return Object.fromEntries(entries);
    } catch { return {}; }
}
function readMainOnly() {
    try { return storage()?.getItem(MAIN_ONLY_KEY) !== 'false'; } catch { return true; }
}
function persist(key: string, value: string) {
    try { storage()?.setItem(key, value); }
    catch { console.warn('[Episodes] Local listening history could not be saved'); }
}
function persistProgress(value: Record<string, EpisodeProgress>) {
    const progress = Object.fromEntries(Object.entries(value)
        .sort((a, b) => getEpisodeHistoryTime(b[1]) - getEpisodeHistoryTime(a[1])).slice(0, MAX_ENTRIES));
    persist(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    return progress;
}

interface EpisodePlaybackState {
    mainOnly: boolean;
    progress: Record<string, EpisodeProgress>;
    toggleMainOnly: () => void;
    saveProgress: (key: string, value: EpisodeProgress) => void;
    hydrateMetadata: (songs: SongResult[]) => void;
    restartEpisode: (song: SongResult) => void;
    deleteEpisode: (key: string) => void;
    clearHistory: (providerId: string) => void;
    beginSession: (key: string) => () => void;
    exportSyncData: (history: boolean, preference: boolean) => FanjiaoSyncData;
    mergeSyncData: (data: FanjiaoSyncData) => void;
}
const restored = restoreFanjiaoState(readProgress(), readMainOnly());
export const useEpisodePlaybackStore = create<EpisodePlaybackState>((set, get) => ({
    mainOnly: restored.mainOnly,
    progress: Object.fromEntries(Object.entries(restored.progress).sort((a, b) => getEpisodeHistoryTime(b[1]) - getEpisodeHistoryTime(a[1])).slice(0, MAX_ENTRIES)),
    toggleMainOnly: () => {
        const mainOnly = !get().mainOnly;
        persistFanjiaoOperation(() => recordFanjiaoPreference(get().progress, get().mainOnly, mainOnly));
        persist(MAIN_ONLY_KEY, String(mainOnly));
        set({ mainOnly });
    },
    saveProgress: (key, value) => {
        if (pendingRestarts.has(key) || isFanjiaoSessionHidden(key) || !key.startsWith('online:') || !validEpisodeProgress(value)) return;
        const previous = get().progress[key];
        const next = normalizeEpisodeProgress({ ...previous, ...value, metadata: value.metadata ?? previous?.metadata })!;
        if (next.lastPlayedAt === 0 && previous) next.lastPlayedAt = getEpisodeHistoryTime(previous);
        persistFanjiaoOperation(() => recordFanjiaoProgress(key, next, get().progress, get().mainOnly));
        const progress = persistProgress({ ...get().progress, [key]: next });
        set({ progress });
    },
    hydrateMetadata: songs => {
        const progress = { ...get().progress };
        let changed = false;
        for (const song of songs) {
            const key = getEpisodeKey(song);
            const metadata = episodeMetadataFromSong(song);
            if (!key || !metadata || !progress[key] || progress[key].metadata) continue;
            persistFanjiaoOperation(() => hydrateFanjiaoMetadata(key, metadata, get().progress, get().mainOnly));
            progress[key] = { ...progress[key], metadata }; changed = true;
        }
        if (!changed) return;
        persist(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
        set({ progress });
    },
    restartEpisode: song => {
        const key = getEpisodeKey(song);
        if (!key) return;
        pendingRestarts.add(key);
        const progress = { ...get().progress };
        const previous = progress[key];
        const duration = previous?.duration ?? (song.durationMs || 0) / 1000;
        if (duration > 0) {
            progress[key] = { ...previous, position: 0, duration, completed: false,
                updatedAt: previous?.updatedAt ?? 0, lastPlayedAt: previous ? getEpisodeHistoryTime(previous) : 0,
                metadata: previous?.metadata ?? episodeMetadataFromSong(song) };
            persistFanjiaoOperation(() => resetFanjiaoEpisode(key, progress[key], get().progress, get().mainOnly));
        } else {
            // Without a duration, retain a reset fence until the first actual playback supplies valid progress.
            persistFanjiaoOperation(() => resetFanjiaoEpisode(key, null, get().progress, get().mainOnly));
        }
        persist(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
        set({ progress });
    },
    deleteEpisode: key => {
        persistFanjiaoOperation(() => resetFanjiaoEpisode(key, null, get().progress, get().mainOnly));
        const progress = { ...get().progress }; delete progress[key]; pendingRestarts.delete(key);
        set({ progress: persistProgress(progress) });
    },
    clearHistory: providerId => {
        if (providerId === 'fanjiao') persistFanjiaoOperation(() => clearFanjiaoHistory(get().progress, get().mainOnly));
        const progress = Object.fromEntries(Object.entries(get().progress).filter(([key]) => !key.startsWith(`online:${providerId}:`)));
        for (const key of pendingRestarts) if (key.startsWith(`online:${providerId}:`)) pendingRestarts.delete(key);
        set({ progress: persistProgress(progress) });
    },
    beginSession: key => {
        beginFanjiaoSession(key);
        return () => set({ progress: persistProgress(endFanjiaoSession(key, get().progress, get().mainOnly)) });
    },
    exportSyncData: (history, preference) => exportFanjiaoData(get().progress, get().mainOnly, history, preference),
    mergeSyncData: data => {
        const next = mergeFanjiaoData(data, get().progress, get().mainOnly);
        persist(MAIN_ONLY_KEY, String(next.mainOnly));
        set({ ...next, progress: persistProgress(next.progress) });
    },
}));

export function getEpisodeResumePosition(song: SongResult | null | undefined, source?: string | null): number | null {
    const key = getEpisodeKey(song);
    if (key && source && !isEpisodeSource(key, source)) return null;
    if (key && pendingRestarts.delete(key)) return 0;
    return key ? getResumePosition(useEpisodePlaybackStore.getState().progress[key]) : null;
}
