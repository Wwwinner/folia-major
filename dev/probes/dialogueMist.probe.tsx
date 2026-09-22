import { useEffect, useRef, useState } from 'react';
import { useMotionValue, useMotionValueEvent } from 'framer-motion';
import { DEFAULT_MONET_TUNING, type Line } from '../../src/types';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import VisualizerRenderer from '../../src/components/visualizer/VisualizerRenderer';
import { useDialogueTimeline } from '../../src/components/visualizer/dialogue/useDialogueTimeline';
import { cover } from './dialogue.probe';
import type { ProbeDefinition } from './definition';

// 正式对白渲染器的可暂停慢看演示；时间按钮冻结雾气阶段，不合成音频或未来台词。
const lines: Line[] = [
    { startTime: 2, endTime: 7, fullText: '夏可：雨还没停，我们再等一会儿吧。', words: [] },
    { startTime: 7, endTime: 12, fullText: '孔今瑶：好，等雾散了，就能看见对岸。', words: [] },
    { startTime: 9, endTime: 13, fullText: '旁白：【远处传来列车声】', words: [] },
    { startTime: 13.5, endTime: 13.85, fullText: '夏可：走吧。', words: [] },
    { startTime: 16, endTime: 20, fullText: '孔今瑶：这一次，我和你一起。', words: [] },
];
function DialogueMistProbe() {
    const currentTime = useMotionValue(1.6), audioPower = useMotionValue(0);
    const [playing, setPlaying] = useState(false);
    const [reference, setReference] = useState(false);
    const { startedCount } = useDialogueTimeline(lines, currentTime);
    const rangeRef = useRef<HTMLInputElement>(null), clockRef = useRef<HTMLOutputElement>(null);
    useMotionValueEvent(currentTime, 'change', time => {
        if (rangeRef.current) rangeRef.current.value = String(time);
        if (clockRef.current) clockRef.current.textContent = `${time.toFixed(2)} 秒`;
    });
    useEffect(() => {
        if (!playing) return;
        let frame = 0, previous = performance.now();
        const tick = (now: number) => {
            const next = Math.min(22, currentTime.get() + (document.hidden ? 0 : Math.min((now - previous) / 1000, 0.1)));
            previous = now; currentTime.set(next);
            if (next >= 22) setPlaying(false); else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, currentTime]);
    const seek = (time: number) => { setPlaying(false); currentTime.set(time); };
    return <div className="h-screen w-screen bg-[#20272a] text-white">
        <div className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#172127]/95 px-4 py-3 text-sm">
            <strong>雾中对白 · 无音频演示</strong>
            <button onClick={() => { currentTime.set(0); setPlaying(true); }}>从头播放</button>
            <button onClick={() => { currentTime.set(5); setPlaying(true); }}>看雾队列</button>
            <button onClick={() => setReference(value => !value)}>{reference ? '切回对白' : '莫奈对照'}</button>
            <button onClick={() => { currentTime.set(6.7); setPlaying(true); }}>播放下一句</button>
            <button onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '继续'}</button>
            <input ref={rangeRef} aria-label="演示时间" type="range" min={0} max={22} step={0.01} defaultValue={1.6}
                className="w-36 accent-[#d4c5af]" onChange={event => seek(Number(event.target.value))} />
            <output ref={clockRef} className="font-mono text-xs">1.60 秒</output>
            {[['雾气占位', 1.6], ['散雾中', 2.1], ['散开后', 3], ['下一句前', 6.7], ['重叠对白', 9.1], ['短句', 13.6]].map(([label, time]) =>
                <button key={label} onClick={() => seek(Number(time))}>{label}</button>)}
        </div>
        <VisualizerRenderer mode={reference ? 'monet' : 'dialogue'} currentTime={currentTime} currentLineIndex={startedCount - 1} lines={lines}
            theme={DEFAULT_THEME} audioPower={audioPower} audioBands={{ bass: audioPower, lowMid: audioPower, mid: audioPower, vocal: audioPower, treble: audioPower }}
            visualizerTunings={{ monet: { ...DEFAULT_MONET_TUNING, glowIntensity: 0.65, showAudioVisualization: false, showDescription: false } }}
            staticMode backgroundStaticMode paused={!playing} background={{ mode: 'common' }} coverUrl={cover}
            songTitle="雾散之后" songArtist="对白入场预览" onLyricLineSeek={seek} />
    </div>;
}
export default { id: 'dialogueMist', title: '雾中对白', description: '两团纯雾连续接棒、莫奈行过渡与音频时钟驱动的散雾。', Component: DialogueMistProbe } satisfies ProbeDefinition;
