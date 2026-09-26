import { Profiler, useMemo, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Line } from '../../src/types';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import VisualizerRenderer from '../../src/components/visualizer/VisualizerRenderer';
import { MonetSettingsPanel } from '../../src/components/visualizer/monet/MonetSettingsPanel';
import { useVisualizerSettingsStore } from '../../src/stores/useVisualizerSettingsStore';
import type { ProbeDefinition } from './definition';

// 对白探针覆盖重叠句、空档、倒带、长记录虚拟化和同一句内的高频时钟更新。
const lines: Line[] = [
    { id: 'rain', startTime: 2, endTime: 6, fullText: '窗外的雨还没停。', words: [] },
    { id: 'question', startTime: 8, endTime: 16, fullText: '你还记得那年夏天，我们一起看过的花火吗？', words: [] },
    { id: 'answer', startTime: 12, endTime: 18, fullText: '记得。那个晚上，风吹过河岸，所有的声音都慢了下来。\n你站在我身旁，什么也没说。', words: [] },
    { id: 'future', startTime: 22, endTime: 28, fullText: '这是还没有发生的对白，不应该提前出现。', words: [] },
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `history-${index}`, startTime: 35 + index * 5, endTime: 39 + index * 5,
        fullText: `第 ${index + 5} 句对白。` + (index % 7 === 0 ? '这是一段更长的台词，换行时也应该完整展示，并且保持当前位置稳定。' : '我会在这里等你。'), words: [] })),
];
export const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="450" height="600"><rect width="450" height="600" fill="#304653"/><circle cx="280" cy="210" r="95" fill="#d5c1a7"/><path d="M0 440L160 250L320 470L450 330V600H0" fill="#192d36"/><text x="45" y="95" fill="#eee4d5" font-size="36">花火之后</text></svg>')}`;

function DialogueProbe() {
    const { t } = useTranslation();
    const monetTuning = useVisualizerSettingsStore(state => state.monetTuning);
    const setMonetTuning = useVisualizerSettingsStore(state => state.handleSetMonetTuning);
    const resetMonetTuning = useVisualizerSettingsStore(state => state.handleResetMonetTuning);
    const [settings, setSettings] = useState(false);
    const currentTime = useMotionValue(13);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0), mid = useMotionValue(0), treble = useMotionValue(0);
    const [lastSeek, setLastSeek] = useState(-1);
    const [episode, setEpisode] = useState(0);
    const [preview, setPreview] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [reference, setReference] = useState(false);
    const [large, setLarge] = useState(false);
    const [wrapSample, setWrapSample] = useState(false);
    const displayLines = useMemo(() => wrapSample ? [
        { ...lines[0], fullText: '夏可：【放下筷子，起身】不好意思，我去一下洗手间。' },
        { ...lines[1], endTime: 11, fullText: '【何径寒自坐着，目光扫过夏可留在桌上的手机，手机屏幕突然亮起，微信提示声响起。】' },
        { ...lines[2], fullText: '孔今瑶：【微信】好~那就约在周六晚上，我们一起吃饭吧。' },
        ...lines.slice(3),
    ] : expanded ? lines.map((line, index) => index === 1
        ? { ...line, fullText: '你还记得那年夏天吗？\n' + '我们沿着河岸走了很久，直到远处的花火照亮夜空。'.repeat(8) } : line) : lines, [expanded, wrapSample]);
    return <div className="h-screen w-screen bg-[#20272a]" data-testid="dialogue-probe">
        <div className="fixed inset-x-0 top-0 z-[100] flex flex-wrap gap-2 bg-black/70 p-1 text-xs text-white">
            <input aria-label="Probe time" data-testid="dialogue-time" type="number" defaultValue={13} className="w-20"
                onChange={event => currentTime.set(Number(event.target.value))} />
            <button onClick={() => setPreview(value => !value)}>Preview</button>
            <button onClick={() => setExpanded(value => !value)}>Update text</button>
            <button onClick={() => setReference(value => !value)}>Monet reference</button>
            <button onClick={() => setLarge(value => !value)}>Font scale</button>
            <button onClick={() => setSettings(value => !value)}>Parameters</button>
            <button onClick={() => { setWrapSample(value => !value); currentTime.set(13); }}>Wrap sample</button>
            <button onClick={() => { currentTime.set(0); setEpisode(value => value + 1); }}>New episode</button>
            <button data-testid="dialogue-tick" onClick={async () => {
                currentTime.set(13);
                for (let index = 0; index < 20; index++) { await new Promise(requestAnimationFrame); currentTime.set(13 + index / 100); }
                document.querySelector('[data-testid="dialogue-probe"]')?.setAttribute('data-ticked', 'true');
            }}>Tick</button>
            <output data-testid="dialogue-seek-result">{lastSeek}</output>
        </div>
        <Profiler id="dialogue" onRender={() => {
            const root = document.querySelector('[data-testid="dialogue-probe"]');
            root?.setAttribute('data-renders', String(Number(root.getAttribute('data-renders') || 0) + 1));
        }}>
            <VisualizerRenderer mode={reference ? 'monet' : 'dialogue'} seed={episode} currentTime={currentTime} currentLineIndex={reference ? 2 : 999}
                visualizerTunings={{ monet: { ...monetTuning, fontScale: large ? 1.8 : monetTuning.fontScale } }}
                lines={episode ? [] : displayLines} theme={DEFAULT_THEME} audioPower={audioPower} audioBands={{ bass, lowMid: mid, mid, vocal: mid, treble }}
                staticMode backgroundStaticMode paused isPreviewMode={preview} background={{ mode: 'common' }}
                songTitle="第一集 · 花火之后" songAlbum="冬日的来信" songArtist="对白模式 · 场景预览" coverUrl={cover}
                onLyricLineSeek={time => { setLastSeek(time); currentTime.set(time); }} />
        </Profiler>
        {settings && <aside className="fixed right-0 top-10 z-50 max-h-[85vh] w-80 overflow-auto bg-[#20272a] p-3 text-white">
            <button onClick={resetMonetTuning}>Reset parameters</button>
            <MonetSettingsPanel t={t} isDaylight={false} theme={DEFAULT_THEME} controlCardBg="#20272a"
                rangeInputClass="w-full" monetTuning={monetTuning} onMonetTuningChange={setMonetTuning} />
        </aside>}
    </div>;
}
export default { id: 'dialogue', title: '对白 · 当前与历史字幕', description: '句级同步、回听、倒带和长篇字幕。', Component: DialogueProbe } satisfies ProbeDefinition;
