import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { Line } from '../../types';
import { DEFAULT_THEME } from '../../services/baseThemes';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../utils/fontStacks';
import { useDialogueTimeline } from '../visualizer/dialogue/useDialogueTimeline';
import { buildMonetGlowShadow, resolveMonetSentenceGlow } from '../visualizer/monet/monetLyricMotion';
import type { DesktopLyricsAppearance } from '../../types/desktopLyrics';

// 当前全部重叠句共享句级时序；没有未来行、封面、频谱或播放控件。
function Sentence({ line, time, appearance }: { line: Line; time: MotionValue<number>; appearance: DesktopLyricsAppearance }) {
    const textShadow = useTransform(time, value => {
        const glow = buildMonetGlowShadow(appearance.fontSize, '#ffffff', '#ffffff',
            resolveMonetSentenceGlow(value, line.startTime, line.endTime), false, appearance.glowIntensity);
        return `0 2px 5px rgba(0,0,0,.9)${glow === 'none' ? '' : `, ${glow}`}`;
    });
    return <motion.p data-testid="desktop-subtitle" data-start-time={line.startTime} data-end-time={line.endTime}
        className="desktop-lyrics-sentence" style={{ textShadow }}>{line.fullText}</motion.p>;
}
export default function DesktopLyricsText({ lines, time, appearance }: {
    lines: Line[]; time: MotionValue<number>; appearance: DesktopLyricsAppearance;
}) {
    const { timeline, active } = useDialogueTimeline(lines, time);
    return <div className="desktop-lyrics-text" data-testid="desktop-lyrics-text" style={{ fontSize: appearance.fontSize,
        fontFamily: resolveThemeFontStack(DEFAULT_THEME), fontWeight: resolveThemeFontWeight(DEFAULT_THEME, 600) }}>
        {[...active].map(index => <Sentence key={`${index}:${timeline.entries[index].line.startTime}`}
            line={timeline.entries[index].line} time={time} appearance={appearance} />)}
    </div>;
}
