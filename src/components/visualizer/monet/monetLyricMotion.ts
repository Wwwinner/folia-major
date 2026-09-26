import type { GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { mixColors } from '../colorMix';

// src/components/visualizer/monet/monetLyricMotion.ts
// Absolute-time envelopes shared by the DOM rail and embedded GPU lyrics.
export const MONET_SCROLL_SPRING = { stiffness: 142, damping: 28, mass: 0.82 };
export const MONET_SCALE_SPRING = { stiffness: 150, damping: 30, mass: 0.78 };
export const clampMonetProgress = (value: number) => Math.min(1, Math.max(0, value));

export function resolveMonetGlow(time: number, start: number, end: number, lineEnd: number): number {
    if (time <= start) return 0;
    const rise = Math.max(0.001, end - start) * 1.18;
    const peak = start + rise;
    const tail = Math.max(lineEnd, end + 1.05);
    if (time <= peak) {
        const progress = clampMonetProgress((time - start) / rise);
        // 使用 Smoothstep (ease-in-out) 曲线，让发光开始和到达峰值时都平滑过渡
        return progress * progress * (3 - 2 * progress);
    }
    const remaining = 1 - clampMonetProgress((time - peak) / Math.max(0.18, tail - peak));
    // 使用 Smoothstep (ease-in-out)，让衰退初期缓慢（有“驻留”感），然后再平滑消失
    return remaining * remaining * (3 - 2 * remaining);
}

// 句级光效独立于逐字进度：短暂柔和亮起，句内保持，结束后按同一播放时钟收光。
export function resolveMonetSentenceGlow(time: number, start: number, end: number): number {
    if (time <= start || end <= start) return 0;
    const rise = Math.min(0.32, (end - start) * 0.25);
    const progress = time < end ? clampMonetProgress((time - start) / rise)
        : 1 - clampMonetProgress((time - end) / 0.6);
    return progress * progress * (3 - 2 * progress);
}

/** 莫奈逐词与整句共用同一光晕半径、混色和强度；扫光蒙版不参与光效。 */
export function buildMonetGlowShadow(fontPx: number, baseColor: string, wordColor: string, intensity: number, isChorus = false, strength = 1): string {
    const resolvedStrength = Number.isFinite(strength) ? Math.min(2, Math.max(0, strength)) : 1;
    if (intensity <= 0 || resolvedStrength === 0) return 'none';
    // 强度调整亮度与扩散范围，保留播放时钟的淡入淡出曲线和原有混色。
    const radiusScale = Math.sqrt(resolvedStrength);
    const radiusOne = Math.round(fontPx * (isChorus ? 0.45 : 0.28) * radiusScale);
    const radiusTwo = Math.round(fontPx * (isChorus ? 0.90 : 0.65) * radiusScale);
    const glowColor = mixColors(baseColor, wordColor, intensity, Math.min(1, intensity * (isChorus ? 1 : 0.88) * resolvedStrength));
    return `0 0 ${radiusOne}px ${glowColor}, 0 0 ${radiusTwo}px ${glowColor}`;
}

/** Interpolates measured glyph positions, including a proportional fallback for untimed graphemes. */
export function resolveMonetFillWidth(time: number, start: number, end: number,
    offsets: number[], timings: GraphemeTiming[]): number {
    const width = offsets.at(-1) ?? 0;
    if (time <= start) return 0;
    if (time >= end) return width;
    const count = Math.min(timings.length, offsets.length - 1);
    if (count > 0) {
        for (let i = 0; i < count; i++) {
            const timing = timings[i];
            const timingStart = Math.max(start, timing.startTime);
            const timingEnd = Math.max(timingStart, timing.endTime);
            if (time < timingStart) return offsets[i];
            if (time <= timingEnd) {
                const progress = (time - timingStart) / Math.max(0.001, timingEnd - timingStart);
                return offsets[i] + (offsets[i + 1] - offsets[i]) * progress;
            }
        }
        return offsets[count] ?? width;
    }
    const index = clampMonetProgress((time - start) / Math.max(0.001, end - start)) * (offsets.length - 1);
    const whole = Math.floor(index);
    return (offsets[whole] ?? width) + ((offsets[whole + 1] ?? width) - (offsets[whole] ?? width)) * (index - whole);
}

export function resolveMonetTone(status: 'active' | 'waiting' | 'passed', offset: number) {
    if (status === 'active') return { alpha: 1, scale: 1, blur: 0, baseAlpha: 0.34 };
    const distance = Math.max(Math.abs(offset), 1);
    const waiting = status === 'waiting';
    return {
        alpha: waiting ? Math.max(0.36, 0.72 - (distance - 1) * 0.18) : Math.max(0.28, 0.52 - (distance - 1) * 0.12),
        scale: Math.max(0.68, 0.72 * Math.pow(0.9, distance - 1)),
        blur: waiting ? distance === 1 ? 0.7 : 1.8 + (distance - 2) * 0.8 : 1.1 + (distance - 1) * 0.7,
        baseAlpha: waiting ? 0.46 : 0.36,
    };
}
