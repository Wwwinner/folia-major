import type { LyricData, PlayerState } from '../types';

// 独立桌面字幕的最小合同；不传封面、媒体地址或播放器操作权限。
export interface DesktopLyricsAppearance { fontSize: number; glowIntensity: number; }
export interface DesktopLyricsState extends DesktopLyricsAppearance { enabled: boolean; locked: boolean; }
export type DesktopLyricsPatch = Partial<DesktopLyricsState> & { resetPosition?: boolean };
export interface DesktopLyricsSnapshot {
    hasTrack: boolean;
    trackKey: string | null;
    lyrics?: LyricData | null;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    playbackRate: number;
    isAdvancing: boolean;
    lyricOffsetMs: number;
    updatedAt: number;
}
export interface DesktopLyricsBridge {
    getState: () => Promise<DesktopLyricsState>;
    update: (patch: DesktopLyricsPatch) => Promise<DesktopLyricsState>;
    onState: (callback: (state: DesktopLyricsState) => void) => () => void;
    getSnapshot: () => Promise<DesktopLyricsSnapshot | null>;
    onSnapshot: (callback: (snapshot: DesktopLyricsSnapshot | null) => void) => () => void;
}
export const DEFAULT_DESKTOP_LYRICS_APPEARANCE: DesktopLyricsAppearance = { fontSize: 36, glowIntensity: 1 };
export function normalizeDesktopLyricsAppearance(value: Partial<DesktopLyricsAppearance> = {}): DesktopLyricsAppearance {
    return {
        fontSize: Number.isFinite(value.fontSize) ? Math.min(64, Math.max(24, value.fontSize!)) : 36,
        glowIntensity: Number.isFinite(value.glowIntensity) ? Math.min(2, Math.max(0, value.glowIntensity!)) : 1,
    };
}
