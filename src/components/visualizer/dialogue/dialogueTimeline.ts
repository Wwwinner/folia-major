import type { Line } from '../../../types';

// 对白只消费句级起止时间；边界索引避免每帧扫描全文或生成逐字时间。
export function buildDialogueTimeline(lines: Line[]) {
    const entries = lines.map((line, sourceIndex) => ({ line, sourceIndex }))
        .filter(({ line }) => line.fullText.trim() && Number.isFinite(line.startTime) && Number.isFinite(line.endTime))
        .sort((a, b) => a.line.startTime - b.line.startTime || a.sourceIndex - b.sourceIndex);
    let latestEnd = -Infinity;
    const maxEnds = entries.map(({ line }) => (latestEnd = Math.max(latestEnd, line.endTime)));
    return { entries, maxEnds, starts: entries.map(({ line }) => line.startTime),
        boundaries: [...new Set(entries.flatMap(({ line }) => [line.startTime, Math.max(line.startTime, line.endTime)]))].sort((a, b) => a - b) };
}
export type DialogueTimeline = ReturnType<typeof buildDialogueTimeline>;

export function countDialogueBoundaries(values: number[], time: number): number {
    let low = 0, high = values.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (values[middle] <= time) low = middle + 1;
        else high = middle;
    }
    return low;
}

export function getDialogueSnapshot(timeline: DialogueTimeline, time: number) {
    const startedCount = countDialogueBoundaries(timeline.starts, time);
    const active = new Set<number>();
    // 保留所有同时发生的对白；到真实 endTime 即转为历史，不借歌词尾迹延长高亮。
    for (let index = countDialogueBoundaries(timeline.maxEnds, time); index < startedCount; index++) {
        if (timeline.entries[index].line.endTime > time) active.add(index);
    }
    return { timeline, startedCount, active, boundary: countDialogueBoundaries(timeline.boundaries, time) };
}
