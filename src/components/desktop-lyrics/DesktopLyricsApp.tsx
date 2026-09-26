import { useState } from 'react';
import { GripHorizontal, LockKeyhole, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Line } from '../../types';
import type { DesktopLyricsPatch } from '../../types/desktopLyrics';
import { useDesktopLyrics } from './useDesktopLyrics';
import DesktopLyricsText from './DesktopLyricsText';
import './desktopLyrics.css';

// 桌面字幕：沿用 Folia 字体与整句光晕，透明文字为主体；仅解锁悬停时显示窗口工具。
// 首屏为可拖动的字幕区域，锁定后完全穿透；无封面、播放器或未来台词。
const EMPTY_LINES: Line[] = [];
export default function DesktopLyricsApp() {
    const { t } = useTranslation();
    const { state, content, time } = useDesktopLyrics();
    const [settings, setSettings] = useState(false);
    const [failed, setFailed] = useState(false);
    const update = (patch: DesktopLyricsPatch) => {
        setFailed(false);
        void window.desktopLyrics?.update(patch).catch(() => setFailed(true));
    };
    return <main className={`desktop-lyrics-window ${state.locked ? 'is-locked' : ''}`} data-testid="desktop-lyrics-window"
        onKeyDown={event => { if (event.key === 'Escape') setSettings(false); }}>
        {!state.locked && <div className={`desktop-lyrics-tools ${settings ? 'is-open' : ''}`}>
            <span className="desktop-lyrics-drag" title={t('desktopLyrics.drag')}><GripHorizontal size={18} /></span>
            <button aria-label={t('desktopLyrics.settings')} aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={17} /></button>
            <button aria-label={t('desktopLyrics.lock')} title={t('desktopLyrics.lockHint')} onClick={() => { setSettings(false); update({ locked: true }); }}><LockKeyhole size={17} /></button>
            <button aria-label={t('desktopLyrics.close')} onClick={() => update({ enabled: false })}><X size={17} /></button>
        </div>}
        {!state.locked && settings && <div className="desktop-lyrics-settings">
            <label>{t('desktopLyrics.fontSize')}<output>{state.fontSize}px</output>
                <input aria-label={t('desktopLyrics.fontSize')} type="range" min={24} max={64} step={1}
                    value={state.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} /></label>
            <label>{t('desktopLyrics.glow')}<output>{Math.round(state.glowIntensity * 100)}%</output>
                <input aria-label={t('desktopLyrics.glow')} type="range" min={0} max={2} step={0.05}
                    value={state.glowIntensity} onChange={event => update({ glowIntensity: Number(event.target.value) })} /></label>
            <p>{t('desktopLyrics.lockHint')}</p>
        </div>}
        <DesktopLyricsText key={content.trackKey} lines={content.lyrics?.lines ?? EMPTY_LINES} time={time} appearance={state} />
        {!state.locked && !content.lyrics?.lines.length && <p className="desktop-lyrics-empty">
            {t(content.hasTrack ? 'desktopLyrics.noLyrics' : 'desktopLyrics.waiting')}
        </p>}
        {failed && !state.locked && <p className="desktop-lyrics-error" role="alert">{t('desktopLyrics.updateFailed')}</p>}
    </main>;
}
