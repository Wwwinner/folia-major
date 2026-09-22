import { useEffect, useRef, useState } from 'react';
import { useMotionValue, useMotionValueEvent } from 'framer-motion';
import { DEFAULT_MONET_TUNING, type Line } from '../../src/types';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import VisualizerRenderer from '../../src/components/visualizer/VisualizerRenderer';
import type { ProbeDefinition } from './definition';

// 可交互复现：长句跨过多条短句，随后按真实结束时间退出；使用正式对白渲染器。
const lines: Line[] = [
    { startTime: 0, endTime: 20, fullText: '林：先听我说完，这句话会持续到二十秒。', words: [] },
    { startTime: 2, endTime: 3, fullText: '许：嗯。', words: [] },
    { startTime: 4, endTime: 5, fullText: '许：我在听。', words: [] },
    { startTime: 6, endTime: 7, fullText: '许：然后呢？', words: [] },
    { startTime: 8, endTime: 9, fullText: '许：你继续。', words: [] },
    { startTime: 10, endTime: 18, fullText: '许：我知道，你可以慢慢说。', words: [] },
    { startTime: 12, endTime: 13, fullText: '旁白：风吹过窗边。', words: [] },
    { startTime: 14, endTime: 15, fullText: '旁白：雨渐渐停了。', words: [] },
    { startTime: 22, endTime: 25, fullText: '林：这是二十二秒才出现的新一句。', words: [] },
];
const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#263942"/><circle cx="250" cy="220" r="145" fill="none" stroke="#d8d3c8" stroke-width="2"/><circle cx="250" cy="280" r="145" fill="none" stroke="#809ca6" stroke-width="2"/><text x="250" y="258" text-anchor="middle" fill="#eee7dc" font-size="38">重叠对白</text></svg>')}`;

function DialogueOverlapProbe() {
    const currentTime = useMotionValue(16);
    const audioPower = useMotionValue(0);
    const [playing, setPlaying] = useState(false);
    const rangeRef = useRef<HTMLInputElement>(null);
    const clockRef = useRef<HTMLOutputElement>(null);
    useMotionValueEvent(currentTime, 'change', time => {
        if (rangeRef.current) rangeRef.current.value = String(time);
        if (clockRef.current) clockRef.current.textContent = `${time.toFixed(1)} / 26 秒`;
    });
    useEffect(() => {
        if (!playing) return;
        let frame = 0, previous = performance.now();
        const tick = (now: number) => {
            const elapsed = document.hidden ? 0 : Math.min((now - previous) / 1000, 0.1);
            previous = now;
            const next = Math.min(26, currentTime.get() + elapsed);
            currentTime.set(next);
            if (next >= 26) setPlaying(false);
            else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, currentTime]);
    const seek = (time: number) => { setPlaying(false); currentTime.set(time); };
    return <div className="h-screen w-screen bg-[#20272a] text-white" data-testid="dialogue-overlap-probe">
        <div className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#172127]/95 px-4 py-3 text-sm">
            <strong>重叠字幕测试</strong>
            <button onClick={() => { currentTime.set(0); setPlaying(true); }}>从头播放演示</button>
            <button onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '继续'}</button>
            <label className="flex items-center gap-2">时间
                <input ref={rangeRef} aria-label="演示时间" type="range" min={0} max={26} step={0.1} defaultValue={16}
                    className="w-36 accent-[#d4c5af]" onChange={event => seek(Number(event.target.value))} />
            </label>
            <output ref={clockRef} data-testid="overlap-clock" className="font-mono text-xs">16.0 / 26 秒</output>
            {[{ time: 16, text: '长句跨越短句' }, { time: 18, text: '第二句结束' }, { time: 20, text: '长句结束' },
                { time: 4, text: '回退到 4 秒' }].map(item => <button key={item.time} onClick={() => seek(item.time)}>{item.text}</button>)}
            <p className="w-full text-xs text-white/60">林：0–20 秒；许：10–18 秒。中间穿插短句。可拖动时间、点击字幕回听、滚轮查看历史；演示无音频。</p>
        </div>
        <VisualizerRenderer mode="dialogue" currentTime={currentTime} currentLineIndex={-1} lines={lines}
            theme={DEFAULT_THEME} audioPower={audioPower} visualizerTunings={{ monet: { ...DEFAULT_MONET_TUNING,
                showAudioVisualization: false, showDescription: false } }}
            audioBands={{ bass: audioPower, lowMid: audioPower, mid: audioPower, vocal: audioPower, treble: audioPower }}
            staticMode backgroundStaticMode paused={!playing} background={{ mode: 'common' }} coverUrl={cover}
            songTitle="未结束的对白" songArtist="长句保留 · 独立结束 · 回退同步" onLyricLineSeek={seek} />
    </div>;
}
export default { id: 'dialogueOverlap', title: '重叠字幕测试', description: '长句跨越短句时保留全部活动字幕。', Component: DialogueOverlapProbe } satisfies ProbeDefinition;
