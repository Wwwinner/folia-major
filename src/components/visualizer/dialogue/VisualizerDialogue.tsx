import { useMemo } from 'react';
import { MotionConfig } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { VisualizerSharedProps } from '../definition';
import monetEntry from '../monet/entry';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { useDialogueTimeline } from './useDialogueTimeline';

// 复用莫奈的 waiting → active 行；提前排两团雾，开始前不挂载未来台词文本。
export default function VisualizerDialogue(props: VisualizerSharedProps) {
    const { t } = useTranslation();
    const { timeline, startedCount, active } = useDialogueTimeline(props.lines, props.currentTime);
    const reducedMotion = useReducedMotionFor('uiMicroMotion');
    const lines = useMemo(() => timeline.entries.slice(0, startedCount + 2).map(entry => entry.line), [timeline, startedCount]);
    const sentencePlayback = useMemo(() => ({ activeLineIndices: active,
        emptyText: t(props.lines.length ? 'dialogue.waiting' : 'dialogue.empty'),
        startedCount,
    }), [active, props.lines.length, t, startedCount]);
    return <div data-testid="visualizer-dialogue" className="h-full w-full">
        <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
            {monetEntry.render({ ...props, lines, currentLineIndex: startedCount - 1, sentencePlayback })}
        </MotionConfig>
    </div>;
}
