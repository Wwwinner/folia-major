import { create } from 'zustand';
import { useEffect } from 'react';
import { DEFAULT_DESKTOP_LYRICS_APPEARANCE, normalizeDesktopLyricsAppearance,
    type DesktopLyricsAppearance, type DesktopLyricsPatch, type DesktopLyricsState } from '../types/desktopLyrics';

// 主进程是窗口状态真源；renderer 只镜像状态，并缓存外观以参与视觉配置导入导出。
const STORAGE_KEY = 'desktop_lyrics_appearance';
const readAppearance = () => {
    try { return normalizeDesktopLyricsAppearance(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
    catch { return DEFAULT_DESKTOP_LYRICS_APPEARANCE; }
};
const persist = (state: DesktopLyricsAppearance) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeDesktopLyricsAppearance(state)));
};
export const useDesktopLyricsStore = create<{
    state: DesktopLyricsState;
    applyState: (state: DesktopLyricsState) => void;
    update: (patch: DesktopLyricsPatch) => Promise<void>;
    setAppearance: (appearance: Partial<DesktopLyricsAppearance>) => Promise<void>;
}>((set, get) => ({
    state: { ...readAppearance(), enabled: false, locked: false },
    applyState: state => { persist(state); set({ state }); },
    update: async patch => {
        if (window.electron?.updateDesktopLyrics) {
            get().applyState(await window.electron.updateDesktopLyrics(patch));
        }
    },
    setAppearance: async appearance => {
        const next = normalizeDesktopLyricsAppearance({ ...get().state, ...appearance });
        persist(next);
        set({ state: { ...get().state, ...next } });
        await get().update(next);
    },
}));

export function useDesktopLyricsStateBridge() {
    useEffect(() => {
        if (!window.electron?.getDesktopLyricsState) return;
        let live = true, received = false;
        const off = window.electron.onDesktopLyricsState?.(state => {
            received = true;
            useDesktopLyricsStore.getState().applyState(state);
        });
        void window.electron.getDesktopLyricsState().then(state => {
            if (live && !received) useDesktopLyricsStore.getState().applyState(state);
        }).catch(() => {});
        return () => { live = false; off?.(); };
    }, []);
}
