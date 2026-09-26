import { describe, expect, it } from 'vitest';
import type { Line } from '../../../src/types';
import { buildDialogueTimeline, countDialogueBoundaries, getDialogueSnapshot } from '../../../src/components/visualizer/dialogue/dialogueTimeline';

// 未发生的对白不得因歌词索引滞后或重叠句而提前暴露。
const line = (text: string, startTime: number, endTime: number): Line => ({ fullText: text, startTime, endTime, words: [] });
const timeline = buildDialogueTimeline([line('A', 2, 5), line('B', 8, 16), line('C', 12, 18), line('D', 22, 24)]);
describe('dialogue timeline', () => {
    it('keeps future lines out before the first cue and at exact boundaries', () => {
        expect(getDialogueSnapshot(timeline, 1).startedCount).toBe(0);
        const start = getDialogueSnapshot(timeline, 2);
        expect(start.startedCount).toBe(1); expect([...start.active]).toEqual([0]);
        expect([...getDialogueSnapshot(timeline, 5).active]).toEqual([]);
    });
    it('highlights overlapping cues together and keeps completed cues in gaps', () => {
        expect([...getDialogueSnapshot(timeline, 13).active]).toEqual([1, 2]);
        const gap = getDialogueSnapshot(timeline, 20);
        expect(gap.startedCount).toBe(3); expect([...gap.active]).toEqual([]);
    });
    it('rewinds the visible prefix instead of keeping a furthest-played watermark', () => {
        expect(getDialogueSnapshot(timeline, 23).startedCount).toBe(4);
        expect(getDialogueSnapshot(timeline, 4).startedCount).toBe(1);
        expect(getDialogueSnapshot(timeline, 0).startedCount).toBe(0);
    });
    it('preserves source identity, duplicate text, spaces and punctuation in unsorted cues', () => {
        const source = [line('同一句，  不同时间。', 8, 10), line('同一句，  不同时间。', 2, 5), line('', 4, 6)];
        const result = buildDialogueTimeline(source);
        expect(result.entries.map(entry => entry.sourceIndex)).toEqual([1, 0]);
        expect(result.entries[0].line.fullText).toBe(source[1].fullText);
        expect(source[0].words).toEqual([]);
    });
    it('keeps the same render boundary while time advances within a sentence', () => {
        expect(countDialogueBoundaries(timeline.boundaries, 13)).toBe(countDialogueBoundaries(timeline.boundaries, 15.99));
        expect(countDialogueBoundaries(timeline.boundaries, 16)).not.toBe(countDialogueBoundaries(timeline.boundaries, 15.99));
    });
    it('retains an older overlapping cue when newer short cues have ended', () => {
        const overlapping = buildDialogueTimeline([line('long', 0, 100), line('short', 1, 2), line('later', 20, 30)]);
        expect([...getDialogueSnapshot(overlapping, 25).active]).toEqual([0, 2]);
        expect([...getDialogueSnapshot(overlapping, 100).active]).toEqual([]);
    });
});
