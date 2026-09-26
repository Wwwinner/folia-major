import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMotionValueEvent, type MotionValue } from 'framer-motion';
import type { Line } from '../../../types';
import { buildDialogueTimeline, countDialogueBoundaries, getDialogueSnapshot } from './dialogueTimeline';

// React 只在字幕开始/结束及跨边界跳转时更新；连续播放时间始终留在 MotionValue。
export function useDialogueTimeline(lines: Line[], currentTime: MotionValue<number>) {
    const timeline = useMemo(() => buildDialogueTimeline(lines), [lines]);
    const [snapshot, setSnapshot] = useState(() => getDialogueSnapshot(timeline, currentTime.get()));
    const boundaryRef = useRef(snapshot.boundary);
    useLayoutEffect(() => {
        const next = getDialogueSnapshot(timeline, currentTime.get());
        boundaryRef.current = next.boundary;
        setSnapshot(next);
    }, [timeline, currentTime]);
    useMotionValueEvent(currentTime, 'change', time => {
        const boundary = countDialogueBoundaries(timeline.boundaries, time);
        if (boundary === boundaryRef.current) return;
        boundaryRef.current = boundary;
        setSnapshot(getDialogueSnapshot(timeline, time));
    });
    // 切集时不借用上一集的可见范围，避免异步歌词抵达时短暂展示未来台词。
    return snapshot.timeline === timeline ? snapshot : getDialogueSnapshot(timeline, currentTime.get());
}
