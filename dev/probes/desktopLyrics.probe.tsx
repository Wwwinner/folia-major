import { useLayoutEffect } from 'react';
import { PlayerState } from '../../src/types';
import type { DesktopLyricsBridge, DesktopLyricsSnapshot, DesktopLyricsState } from '../../src/types/desktopLyrics';
import DesktopLyricsApp from '../../src/components/desktop-lyrics/DesktopLyricsApp';
import type { ProbeDefinition } from './definition';

// 浏览器演示仅模拟跨窗口消息；字幕与设置 UI 使用正式组件。
const listeners = new Set<(snapshot: DesktopLyricsSnapshot | null) => void>();
const stateListeners = new Set<(state: DesktopLyricsState) => void>();
let state: DesktopLyricsState;
let snapshot: DesktopLyricsSnapshot;
const move = (time: number, changed = false) => {
    snapshot = { ...snapshot, currentTime: time, updatedAt: Date.now(), trackKey: changed ? 'episode-2' : 'episode-1',
        lyrics: changed ? { lines: [{ startTime: 0, endTime: 10, fullText: '这是另一集的字幕。', words: [] }] } : snapshot.lyrics };
    listeners.forEach(listener => listener(snapshot));
};
function DesktopLyricsProbe() {
    useLayoutEffect(() => {
        const previous = window.desktopLyrics;
        state = { enabled: true, locked: false, fontSize: 36, glowIntensity: 1 };
        snapshot = { hasTrack: true, trackKey: 'episode-1', currentTime: 12, duration: 30, updatedAt: Date.now(),
            playbackRate: 1, isAdvancing: false, lyricOffsetMs: 0, playerState: PlayerState.PAUSED,
            lyrics: { lines: [
                { startTime: 0, endTime: 20, fullText: '林：先听我说完，这句话还没有结束。', words: [] },
                { startTime: 10, endTime: 15, fullText: '许：我在听，你慢慢说。', words: [] },
                { startTime: 22, endTime: 25, fullText: '这是未来字幕，不能提前显示。', words: [] },
            ] } };
        window.desktopLyrics = {
            getState: async () => state, getSnapshot: async () => snapshot,
            update: async patch => { state = { ...state, ...patch }; stateListeners.forEach(listener => listener(state)); return state; },
            onState: listener => { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; },
            onSnapshot: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        } satisfies DesktopLyricsBridge;
        return () => { window.desktopLyrics = previous; listeners.clear(); stateListeners.clear(); };
    }, []);
    return <><div style={{ position: 'fixed', inset: 0 }}><DesktopLyricsApp /></div><div data-testid="caption-test-controls" style={{ position: 'fixed', bottom: 0, left: 0, zIndex: 20, fontSize: 11, background: '#222', color: '#fff' }}>
        <button onClick={() => move(12)}>重叠</button> <button onClick={() => move(15)}>句子结束</button>{' '}
        <button onClick={() => move(4)}>回退</button> <button onClick={() => move(3, true)}>换集</button>{' '}
        <button onClick={() => void window.desktopLyrics?.update({ locked: false })}>解锁</button>
    </div></>;
}
export default { id: 'desktopLyrics', title: '独立桌面字幕', description: '重叠、倒带、换集及锁定后的纯字幕视图。', Component: DesktopLyricsProbe } satisfies ProbeDefinition;
