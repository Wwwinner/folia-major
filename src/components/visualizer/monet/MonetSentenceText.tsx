import { useLayoutEffect, useRef } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { Line, Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { buildMonetGlowShadow, resolveMonetSentenceGlow } from './monetLyricMotion';

// 整句使用一个光效订阅；文本按 pretext 相同的规则换行，不创建逐字蒙版或逐字时序。
export default function MonetSentenceText({ line, currentTime, theme, fontPx, reducedMotion, lineHeightPx, measureKey, onMeasure, fontsEpoch, glowIntensity }: {
    line: Line; currentTime: MotionValue<number>; theme: Theme; fontPx: number; reducedMotion: boolean;
    lineHeightPx: number; measureKey: string; onMeasure: (key: string, rows: number) => void;
    fontsEpoch: number;
    glowIntensity: number;
}) {
    const elementRef = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const node = elementRef.current;
        if (!node) return;
        const report = (height: number) => onMeasure(measureKey, Math.max(1, Math.round(height / lineHeightPx)));
        report(node.scrollHeight);
        const observer = new ResizeObserver(entries => {
            if (entries[0]) report(entries[0].contentRect.height);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [measureKey, lineHeightPx, onMeasure, fontsEpoch]);
    const color = colorWithAlpha(theme.primaryColor, 0.98);
    const baseColor = colorWithAlpha(theme.primaryColor, 0.34);
    const textShadow = useTransform(currentTime, time => {
        const intensity = reducedMotion ? (time >= line.startTime && time < line.endTime ? 1 : 0)
            : resolveMonetSentenceGlow(time, line.startTime, line.endTime);
        return buildMonetGlowShadow(fontPx, baseColor, color, intensity, line.isChorus, glowIntensity);
    });
    return <motion.span ref={elementRef} data-monet-sentence-text style={{ display: 'block', width: '100%', paddingRight: 8,
        boxSizing: 'border-box', whiteSpace: 'pre-wrap', textWrap: 'pretty', wordBreak: 'normal', overflowWrap: 'break-word', color, textShadow }}>
        {line.fullText}
    </motion.span>;
}
