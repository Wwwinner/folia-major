import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Theme } from '../../../types';
import { dialogueMistDissolveProgress, dialogueMistProgress } from './dialogueMistMotion';
import { DialogueMistTexture } from './DialogueMistTexture';

// 雾与台词共享莫奈行节点；材质内部流动和散开都由播放时钟驱动，不额外移动字幕。
function MistCloud({ progress, currentTime, color, seed, pending = false }: {
    progress: MotionValue<number>; currentTime: MotionValue<number>; color: string; seed: number; pending?: boolean;
}) {
    const dissolve = useTransform(progress, dialogueMistDissolveProgress);
    const opacity = useTransform(dissolve, value => (1 - value) ** 0.7 * (pending ? 0.75 : 0.8));
    return <motion.div aria-hidden="true"
        data-dialogue-mist={pending ? 'pending' : 'reveal'}
        className="pointer-events-none absolute inset-0" style={{ opacity,
            top: -16, bottom: -16, maxWidth: 420 + ((seed * 0.618) % 1) * 50, maxHeight: 160, transformOrigin: '35% 50%' }}>
        <DialogueMistTexture currentTime={currentTime} progress={dissolve} color={color} seed={seed} />
    </motion.div>;
}

export function DialogueMistReveal({ children, currentTime, start, end, theme, disabled, pending, reservedHeight, seed }: {
    children: ReactNode; currentTime: MotionValue<number>; start: number; end: number; theme: Theme; disabled: boolean;
    pending: boolean; reservedHeight: number; seed: number;
}) {
    const progress = useTransform(currentTime, time => disabled ? 1 : dialogueMistProgress(time, start, end));
    const opacity = useTransform(progress, value => Math.pow(value, 0.6));
    return <div className="relative" data-dialogue-reveal style={{ height: pending ? reservedHeight : undefined }}>
        <motion.div style={{ opacity }}>{pending ? null : children}</motion.div>
        {!disabled && <MistCloud progress={progress} currentTime={currentTime} color={theme.primaryColor} pending={pending} seed={seed} />}
    </div>;
}
