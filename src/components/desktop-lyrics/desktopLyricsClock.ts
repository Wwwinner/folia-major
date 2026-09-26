import { PlayerState } from '../../types';
import type { DesktopLyricsSnapshot } from '../../types/desktopLyrics';

// 本地单调时钟外推半秒快照，失去发布者后最多推进一秒，避免后台断联继续显示后文。
export function desktopLyricsTime(snapshot: DesktopLyricsSnapshot | null, elapsedMs: number) {
    if (!snapshot) return 0;
    const delta = snapshot.playerState === PlayerState.PLAYING && snapshot.isAdvancing
        ? Math.min(1000, Math.max(0, elapsedMs)) / 1000 * snapshot.playbackRate : 0;
    const position = snapshot.currentTime + delta;
    return (snapshot.duration > 0 ? Math.min(snapshot.duration, position) : position) - snapshot.lyricOffsetMs / 1000;
}
