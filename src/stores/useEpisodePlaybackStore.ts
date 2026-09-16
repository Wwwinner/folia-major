import { create } from 'zustand';
import type { SongResult } from '../types';
import { getEpisodeKey, getResumePosition, validEpisodeProgress, type EpisodeProgress } from '../utils/episodePlayback';
import { isEpisodeSource } from '../services/playbackMediaSource';

// 逐集收听位置属于本机历史；同步写入轻量记录，避免退出时等待异步数据库事务。
export const EPISODE_PROGRESS_STORAGE_KEY = 'folia_episode_progress_v1';
const MAIN_ONLY_KEY = 'folia_main_episodes_only';
const MAX_ENTRIES = 2000;
const pendingRestarts = new Set<string>();
const storage = () => typeof localStorage === 'undefined' ? null : localStorage;
function readProgress(): Record<string, EpisodeProgress> {
    try {
        const raw = JSON.parse(storage()?.getItem(EPISODE_PROGRESS_STORAGE_KEY) || '{}');
        return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith('online:') && validEpisodeProgress(value))
            .sort((a, b) => (b[1] as EpisodeProgress).updatedAt - (a[1] as EpisodeProgress).updatedAt)
            .slice(0, MAX_ENTRIES)) as Record<string, EpisodeProgress>;
    } catch { return {}; }
}
function readMainOnly() {
    try { return storage()?.getItem(MAIN_ONLY_KEY) !== 'false'; } catch { return true; }
}
function persist(key: string, value: string) {
    try { storage()?.setItem(key, value); }
    catch { console.warn('[Episodes] Local listening history could not be saved'); }
}

interface EpisodePlaybackState {
    mainOnly: boolean;
    progress: Record<string, EpisodeProgress>;
    toggleMainOnly: () => void;
    saveProgress: (key: string, value: EpisodeProgress) => void;
    restartEpisode: (song: SongResult) => void;
}
export const useEpisodePlaybackStore = create<EpisodePlaybackState>((set, get) => ({
    mainOnly: readMainOnly(),
    progress: readProgress(),
    toggleMainOnly: () => {
        const mainOnly = !get().mainOnly;
        persist(MAIN_ONLY_KEY, String(mainOnly));
        set({ mainOnly });
    },
    saveProgress: (key, value) => {
        if (pendingRestarts.has(key) || !key.startsWith('online:') || !validEpisodeProgress(value)) return;
        const entries = Object.entries({ ...get().progress, [key]: value })
            .sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_ENTRIES);
        const progress = Object.fromEntries(entries);
        persist(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
        set({ progress });
    },
    restartEpisode: song => {
        const key = getEpisodeKey(song);
        if (!key) return;
        pendingRestarts.add(key);
        const progress = { ...get().progress };
        delete progress[key];
        persist(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
        set({ progress });
    },
}));

export function getEpisodeResumePosition(song: SongResult | null | undefined, source?: string | null): number | null {
    const key = getEpisodeKey(song);
    if (key && source && !isEpisodeSource(key, source)) return null;
    if (key && pendingRestarts.delete(key)) return 0;
    return key ? getResumePosition(useEpisodePlaybackStore.getState().progress[key]) : null;
}
