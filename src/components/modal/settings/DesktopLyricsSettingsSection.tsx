import { useState } from 'react';
import { Captions, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DesktopLyricsPatch } from '../../../types/desktopLyrics';
import { useDesktopLyricsStore } from '../../../stores/useDesktopLyricsStore';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import type { DesktopSettingsChrome } from './DesktopSettingsSubview';

// 桌面窗口操作与独立字幕外观使用同一主进程状态，托盘改动也会即时反映到这里。
export default function DesktopLyricsSettingsSection({ chrome }: { chrome: DesktopSettingsChrome }) {
    const { t } = useTranslation();
    const state = useDesktopLyricsStore(store => store.state);
    const [failed, setFailed] = useState(false);
    const update = (patch: DesktopLyricsPatch) => {
        setFailed(false);
        void useDesktopLyricsStore.getState().update(patch).catch(() => setFailed(true));
    };
    const renderToggle = (label: string, checked: boolean, onChange: () => void, disabled = false) => (
        <button type="button" role="switch" aria-checked={checked} aria-label={label}
            onClick={onChange} disabled={disabled}
            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${!checked ? chrome.toggleOffBackgroundClass : ''}`}
            style={{ backgroundColor: checked ? chrome.theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}>
            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );
    return <SettingsAnchor anchorId="desktopLyrics" label={t('desktopLyrics.title')}>
        <SettingsSectionHeading icon={Captions} label={t('desktopLyrics.title')} />
        <div className={`p-4 rounded-xl border space-y-4 ${chrome.settingsCardClass}`}>
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('desktopLyrics.open')}</div>
                    <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('desktopLyrics.description')}
                    </div>
                </div>
                {renderToggle(t('desktopLyrics.open'), state.enabled, () => update({ enabled: !state.enabled }))}
            </div>
            <div className="flex items-center justify-between gap-4 pt-1">
                <div className="space-y-0.5 min-w-0">
                    <div className="text-xs" style={{ color: 'var(--text-primary)' }}>{t('desktopLyrics.lock')}</div>
                    <div className="text-xs opacity-50 max-w-[300px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('desktopLyrics.lockHint')}
                    </div>
                </div>
                {renderToggle(t('desktopLyrics.lock'), state.locked, () => update({ locked: !state.locked }), !state.enabled)}
            </div>
            <label className="flex items-center justify-between gap-4 pt-1">
                <span className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{t('desktopLyrics.fontSize')}</span>
                <span className="flex items-center gap-2 shrink-0">
                    <input aria-label={t('desktopLyrics.fontSize')} aria-valuetext={`${state.fontSize}px`}
                        className="w-36 accent-current" type="range" min={24} max={64} step={1}
                        value={state.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} />
                    <output className="text-xs font-mono w-12 text-right" style={{ color: 'var(--text-primary)' }}>{state.fontSize}px</output>
                </span>
            </label>
            <label className="flex items-center justify-between gap-4 pt-1">
                <span className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{t('desktopLyrics.glow')}</span>
                <span className="flex items-center gap-2 shrink-0">
                    <input aria-label={t('desktopLyrics.glow')} aria-valuetext={`${Math.round(state.glowIntensity * 100)}%`}
                        className="w-36 accent-current" type="range" min={0} max={2} step={0.05}
                        value={state.glowIntensity} onChange={event => update({ glowIntensity: Number(event.target.value) })} />
                    <output className="text-xs font-mono w-12 text-right" style={{ color: 'var(--text-primary)' }}>{Math.round(state.glowIntensity * 100)}%</output>
                </span>
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => update({ resetPosition: true, locked: false })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${chrome.utilityGhostButtonClass}`}
                    style={{ color: 'var(--text-primary)' }}>
                    <RotateCcw size={14} />{t('desktopLyrics.resetPosition')}
                </button>
            </div>
            {failed && <p role="alert" className="text-xs" style={{ color: 'var(--text-primary)' }}>{t('desktopLyrics.updateFailed')}</p>}
        </div>
    </SettingsAnchor>;
}
