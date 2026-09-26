import { lazy } from 'react';
import { defineVisualizer } from '../definition';
import monetEntry from '../monet/entry';

// 对白是莫奈的句级版本，共用莫奈外观参数和设置面板。
const VisualizerDialogue = lazy(() => import('./VisualizerDialogue'));
export default defineVisualizer({
    ...monetEntry,
    mode: 'dialogue', order: 91, labelKey: 'ui.visualizerDialogue', labelFallback: 'Dialogue',
    previewSeed: 'dialogue', previewStartOffset: 0,
    render: props => <VisualizerDialogue {...props} />,
});
