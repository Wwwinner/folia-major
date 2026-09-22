import { describe, expect, it } from 'vitest';
import type { Line } from '../../../src/types';
import { buildMonetVisibleLineEntries } from '../../../src/components/visualizer/monet/monetLyricsModel';
import { centerDialogueActiveGroup, fitDialogueActiveGroup, positionDialogueMistQueue, retainDialogueActiveEntries } from '../../../src/components/visualizer/dialogue/dialogueRailEntries';
import { buildDialogueTimeline, getDialogueSnapshot } from '../../../src/components/visualizer/dialogue/dialogueTimeline';

// 窗口保留和排版分别回归，防止“仍在 DOM 中但已被历史顶出视野”的假修复。
const lines: Line[] = Array.from({ length: 9 }, (_, index) => ({
    startTime: index * 2, endTime: index === 0 ? 30 : index * 2 + 1,
    fullText: `句 ${index}`, words: [],
}));
const timeline = buildDialogueTimeline(lines);
function visibleAt(time: number) {
    const { startedCount, active } = getDialogueSnapshot(timeline, time);
    const started = lines.slice(0, startedCount);
    const index = startedCount - 1;
    const window = buildMonetVisibleLineEntries({ lines: started, currentLineIndex: index,
        activeLine: started[index], recentCompletedLine: null, upcomingLine: null, currentTime: time });
    return retainDialogueActiveEntries(window, started, active);
}
describe('dialogue overlap window', () => {
    it('keeps the upcoming row identity while switching waiting to active', () => {
        const window = buildMonetVisibleLineEntries({ lines: lines.slice(0, 3), currentLineIndex: 0,
            activeLine: lines[0], recentCompletedLine: null, upcomingLine: lines[1], currentTime: 1 });
        const before = retainDialogueActiveEntries(window, lines, new Set([0]), 1);
        const after = retainDialogueActiveEntries(window, lines, new Set([0, 1]), 2);
        expect(before.map(entry => entry.status)).toEqual(['active', 'waiting', 'waiting']);
        expect(after.map(entry => entry.status)).toEqual(['active', 'active', 'waiting']);
        expect(before[1].key).toBe(after[1].key);
        expect(before[2].key).toBe(after[2].key);
    });
    it('places the second mist near the lower fade without moving active rows or overlapping tall cues', () => {
        const entries = ['active', 'waiting', 'waiting'].map((status, index) => ({ status, y: 200 + index * 60, scaledHeight: 50 }));
        const positioned = positionDialogueMistQueue(entries, 500);
        expect(positioned[0]).toBe(entries[0]);
        expect(positioned[1]).toBe(entries[1]);
        expect(positioned[2].y).toBeGreaterThan(400);
        expect(positionDialogueMistQueue([{ ...entries[0] }, { ...entries[1], y: 470 }, { ...entries[2], y: 530 }], 500)[2].y).toBe(530);
    });
    it('keeps older active cues beyond Monet’s normal window without duplicating them', () => {
        const entries = visibleAt(16.5);
        expect(entries.map(entry => entry.index)).toEqual([0, 6, 7, 8]);
        expect(entries.filter(entry => entry.status === 'active').map(entry => entry.index)).toEqual([0, 8]);
        expect(entries).toHaveLength(4);
    });
    it('keeps the long cue after short cues end and removes its active state at its real end', () => {
        expect(visibleAt(17).filter(entry => entry.status === 'active').map(entry => entry.index)).toEqual([0]);
        expect(visibleAt(30).filter(entry => entry.status === 'active')).toEqual([]);
        expect(visibleAt(4.5).map(entry => entry.index)).toEqual([0, 1, 2]);
    });
    it('collapses only intervening history if the active group cannot fit', () => {
        const entries = [true, false, false, true].map((active, index) => ({ index,
            status: active ? 'active' : 'passed', scaledHeight: 80, y: index * 90 }));
        const fitted = fitDialogueActiveGroup(entries, 300, () => 10);
        expect(fitted.map(entry => entry.index)).toEqual([0, 3]);
        expect(entries).toHaveLength(4);
        expect(fitDialogueActiveGroup(entries, 600, () => 10)).toEqual(entries);
    });
    it('centers the active group and never discards cues even when the whole group is very tall', () => {
        const entries = [0, 1, 2, 3].map(index => ({ status: 'active', y: index * 90, scaledHeight: 80 }));
        const fitted = fitDialogueActiveGroup(entries, 300, () => 10);
        expect(fitted).toHaveLength(4);
        const centered = centerDialogueActiveGroup(fitted, 500);
        expect((centered[0].y + centered.at(-1)!.y + 80) / 2).toBe(230);
        expect(centered[1].y - centered[0].y).toBe(90);
    });
});
