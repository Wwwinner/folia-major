import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Theme } from '../../../types';
import { dialogueMistAnticipation, dialogueMistDissolveProgress, dialogueMistProgress } from './dialogueMistMotion';
import { DialogueMistTexture } from './DialogueMistTexture';

// 雾与台词共享莫奈行节点；材质内部流动和散开都由播放时钟驱动，不额外移动字幕。
function MistCloud({ progress, currentTime, start, color, seed, contentWidth, lineHeight, pending = false }: {
    progress: MotionValue<number>; currentTime: MotionValue<number>; start: number; color: string; seed: number; pending?: boolean;
    contentWidth: number; lineHeight: number;
}) {
    const dissolve = useTransform(progress, dialogueMistDissolveProgress);
    const anticipation = useTransform(currentTime, time => dialogueMistAnticipation(time, start));
    const opacity = useTransform(() => anticipation.get() * (1 - dissolve.get()) ** 0.7 * (pending ? 0.75 : 0.8));
    // 视觉边缘在已有光晕留白内扩散，文字和行轨道的尺寸保持不变。
    const sideBleed = Math.min(lineHeight * 0.15, 6), verticalBleed = Math.min(lineHeight * 0.18, 8);
    return <motion.div aria-hidden="true"
        data-dialogue-mist={pending ? 'pending' : 'reveal'}
        className="pointer-events-none absolute" style={{ opacity,
            left: -sideBleed, width: contentWidth + sideBleed * 2, maxWidth: `calc(100% + ${sideBleed * 2}px)`,
            top: -verticalBleed, bottom: -verticalBleed }}>
        <DialogueMistTexture currentTime={currentTime} progress={dissolve} opacity={opacity} color={color} seed={seed}
            padding={Math.min(lineHeight * 0.4, 16)} />
    </motion.div>;
}

export function DialogueMistReveal({ children, currentTime, start, end, theme, disabled, pending, reservedHeight, seed, contentWidth, lineHeight }: {
    children: ReactNode; currentTime: MotionValue<number>; start: number; end: number; theme: Theme; disabled: boolean;
    pending: boolean; reservedHeight: number; seed: number;
    contentWidth: number; lineHeight: number;
}) {
    const progress = useTransform(currentTime, time => disabled ? 1 : dialogueMistProgress(time, start, end));
    const opacity = useTransform(progress, value => Math.pow(value, 0.6));
    return <div className="relative" data-dialogue-reveal style={{ height: pending ? reservedHeight : undefined }}>
        <motion.div className="relative z-[1]" style={{ opacity }}>{pending ? null : children}</motion.div>
        {!disabled && <MistCloud progress={progress} currentTime={currentTime} start={start} color={theme.primaryColor}
            pending={pending} seed={seed} contentWidth={contentWidth} lineHeight={lineHeight} />}
    </div>;
}
