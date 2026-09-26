import { describe, expect, it } from 'vitest';
import { buildMonetGlowShadow, resolveMonetSentenceGlow } from '../../../src/components/visualizer/monet/monetLyricMotion';

// 整句光效只依赖句子区间和播放时钟，暂停、跳转都不依赖独立动画计时器。
describe('Monet whole-line glow', () => {
    it('rises together, holds through the cue and fades after its real end', () => {
        expect(resolveMonetSentenceGlow(9, 10, 20)).toBe(0);
        expect(resolveMonetSentenceGlow(10, 10, 20)).toBe(0);
        expect(resolveMonetSentenceGlow(10.16, 10, 20)).toBeCloseTo(0.5);
        expect(resolveMonetSentenceGlow(11, 10, 20)).toBe(1);
        expect(resolveMonetSentenceGlow(19.9, 10, 20)).toBe(1);
        expect(resolveMonetSentenceGlow(20.3, 10, 20)).toBeCloseTo(0.5);
        expect(resolveMonetSentenceGlow(21, 10, 20)).toBe(0);
    });
    it('also fully illuminates short cues without requiring word timestamps', () => {
        expect(resolveMonetSentenceGlow(10.03, 10, 10.1)).toBe(1);
        expect(resolveMonetSentenceGlow(10, 10, 10)).toBe(0);
    });
    it('is stable while paused and immediately follows rewinds', () => {
        const paused = resolveMonetSentenceGlow(10.1, 10, 20);
        expect(resolveMonetSentenceGlow(10.1, 10, 20)).toBe(paused);
        expect(resolveMonetSentenceGlow(19, 10, 20)).toBe(1);
        expect(resolveMonetSentenceGlow(10.1, 10, 20)).toBe(paused);
        expect(resolveMonetSentenceGlow(0, 10, 20)).toBe(0);
    });
    it('uses Monet’s existing two glow radii and shared color mixing', () => {
        expect(buildMonetGlowShadow(40, '#ffffff', '#ffffff', 0)).toBe('none');
        const shadow = buildMonetGlowShadow(40, '#ffffff', '#ffffff', 1);
        expect(shadow).toContain('0 0 11px');
        expect(shadow).toContain('0 0 26px');
        expect(buildMonetGlowShadow(40, '#ffffff', '#ffffff', 1, true)).toContain('0 0 36px');
    });
    it('adjusts glow independently of cue timing, with zero disabling it', () => {
        const shadow = (strength: number) => buildMonetGlowShadow(40, '#ffffff', '#ffffff', 1, false, strength);
        expect(shadow(0)).toBe('none');
        expect(shadow(-1)).toBe('none');
        expect(shadow(1)).toBe(buildMonetGlowShadow(40, '#ffffff', '#ffffff', 1));
        expect(shadow(0.5)).toContain('0 0 18px');
        expect(shadow(2)).toContain('0 0 37px');
        expect(shadow(10)).toBe(shadow(2));
        expect(shadow(NaN)).toBe(shadow(1));
    });
});
