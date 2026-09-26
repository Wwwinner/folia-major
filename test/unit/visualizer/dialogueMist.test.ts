import { describe, expect, it } from 'vitest';
import { dialogueMistDissolveProgress, dialogueMistProgress } from '../../../src/components/visualizer/dialogue/dialogueMistMotion';

// 散雾跟随播放时钟，不能延后短句的可读时间。
describe('dialogue mist timing and placement', () => {
    it('reveals the whole sentence together after its start', () => {
        expect(dialogueMistProgress(1.9, 2, 6)).toBe(0);
        expect(dialogueMistProgress(2, 2, 6)).toBe(0);
        expect(dialogueMistProgress(2.1, 2, 6)).toBeGreaterThan(0.3);
        expect(dialogueMistProgress(2.65, 2, 6)).toBe(1);
    });
    it('finishes early enough for short and zero-length cues', () => {
        expect(dialogueMistProgress(13.65, 13.5, 13.85)).toBe(1);
        expect(dialogueMistProgress(2, 2, 2)).toBe(1);
    });
    it('is deterministic on pause and rewind', () => {
        const partial = dialogueMistProgress(2.1, 2, 6);
        expect(dialogueMistProgress(3, 2, 6)).toBe(1);
        expect(dialogueMistProgress(2.1, 2, 6)).toBe(partial);
    });
    it('keeps the rising mist intact while text starts appearing, then dissolves before the cue ends', () => {
        const early = dialogueMistProgress(2.08, 2, 6);
        expect(early).toBeGreaterThan(0);
        expect(dialogueMistDissolveProgress(early)).toBe(0);
        expect(dialogueMistDissolveProgress(dialogueMistProgress(2.3, 2, 6))).toBeGreaterThan(0.5);
        expect(dialogueMistDissolveProgress(dialogueMistProgress(2.65, 2, 6))).toBe(1);
        expect(dialogueMistDissolveProgress(dialogueMistProgress(13.65, 13.5, 13.85))).toBe(1);
    });
});
