import { useEffect, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { DEFAULT_DESKTOP_LYRICS_APPEARANCE, type DesktopLyricsSnapshot, type DesktopLyricsState } from '../../types/desktopLyrics';
import { desktopLyricsTime } from './desktopLyricsClock';

// 只有歌词集合、窗口状态进入 React；播放时钟只更新 MotionValue。
export function useDesktopLyrics() {
    const [state, setState] = useState<DesktopLyricsState>({ ...DEFAULT_DESKTOP_LYRICS_APPEARANCE, enabled: true, locked: false });
    const [content, setContent] = useState<Pick<DesktopLyricsSnapshot, 'trackKey' | 'lyrics' | 'hasTrack'>>({ trackKey: null, lyrics: null, hasTrack: false });
    const time = useMotionValue(0);
    const sync = useRef<{ snapshot: DesktopLyricsSnapshot | null; received: number }>({ snapshot: null, received: 0 });
    useEffect(() => {
        const bridge = window.desktopLyrics;
        if (!bridge) return;
        let live = true, frame = 0, stateReceived = false, snapshotReceived = false;
        const tick = () => {
            const { snapshot, received } = sync.current;
            const elapsed = performance.now() - received;
            time.set(desktopLyricsTime(snapshot, elapsed));
            if (snapshot?.isAdvancing && elapsed < 1000) frame = requestAnimationFrame(tick);
        };
        const applySnapshot = (snapshot: DesktopLyricsSnapshot | null) => {
            if (!live) return;
            const previous = sync.current.snapshot;
            // 普通时钟包不重复传全文；歌词更新与换集时才重建字幕时序索引。
            setContent(value => {
                const sameTrack = value.trackKey === (snapshot?.trackKey ?? null);
                const next = { trackKey: snapshot?.trackKey ?? null, hasTrack: snapshot?.hasTrack ?? false,
                    lyrics: snapshot?.lyrics === undefined && sameTrack ? value.lyrics : snapshot?.lyrics ?? null };
                if (sameTrack && value.hasTrack === next.hasTrack && value.lyrics === next.lyrics) return value;
                return next;
            });
            const frozen = previous?.trackKey === snapshot?.trackKey && previous?.updatedAt !== snapshot?.updatedAt
                && previous?.currentTime === snapshot?.currentTime;
            sync.current = { snapshot: snapshot && frozen ? { ...snapshot, isAdvancing: false } : snapshot, received: performance.now() };
            cancelAnimationFrame(frame);
            tick();
        };
        const offState = bridge.onState(value => { stateReceived = true; setState(value); });
        const offSnapshot = bridge.onSnapshot(value => { snapshotReceived = true; applySnapshot(value); });
        void bridge.getState().then(value => { if (live && !stateReceived) setState(value); }).catch(() => {});
        void bridge.getSnapshot().then(value => { if (live && !snapshotReceived) applySnapshot(value); }).catch(() => {});
        return () => { live = false; cancelAnimationFrame(frame); offState(); offSnapshot(); };
    }, [time]);
    return { state, content, time };
}
