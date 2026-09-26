import { useEffect, useId, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { NetworkProxyMode, NetworkProxySettings } from '../../../types/networkProxy';
import { CustomSelect } from '../../shared/CustomSelect';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';

// 代理配置独立保存，沿用桌面设置视觉结构；不会在编辑过程中改变正在播放的网络连接。
export default function ProxySettingsSection({ borderColor, settingsCardClass, isDaylight, theme }: {
    borderColor: string; settingsCardClass: string; isDaylight: boolean; theme?: Theme;
}) {
    const { t } = useTranslation();
    const inputId = useId();
    const [draft, setDraft] = useState<NetworkProxySettings>({ mode: 'system', address: '' });
    const [saved, setSaved] = useState<NetworkProxySettings | null>(null);
    const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved'>('loading');
    const [error, setError] = useState('');
    const [restartRequired, setRestartRequired] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true;
        setStatus('loading'); setError('');
        window.electron?.getSettings().then(settings => {
            if (!active) return;
            if (!settings.NETWORK_PROXY_SUPPORTED) { setError('options.proxyUnsupported'); return; }
            setDraft(settings.NETWORK_PROXY); setSaved(settings.NETWORK_PROXY);
            setRestartRequired(Boolean(settings.NETWORK_PROXY_RESTART_REQUIRED));
        }).catch(() => { if (active) setError('options.proxyLoadError'); })
            .finally(() => { if (active) setStatus('idle'); });
        return () => { active = false; };
    }, [retry]);
    const dirty = Boolean(saved && (draft.mode !== saved.mode || (draft.mode === 'custom' && draft.address.trim() !== saved.address)));
    const edit = (next: NetworkProxySettings) => { setDraft(next); setError(''); setStatus('idle'); };
    const save = async () => {
        if (!dirty || status === 'saving') return;
        if (draft.mode === 'custom' && !draft.address.trim()) { setError('options.proxyInvalid'); return; }
        setStatus('saving'); setError('');
        try {
            const result = await window.electron!.saveSettings('NETWORK_PROXY', draft);
            setDraft(result.NETWORK_PROXY); setSaved(result.NETWORK_PROXY);
            setRestartRequired(Boolean(result.NETWORK_PROXY_RESTART_REQUIRED)); setStatus('saved');
        } catch (failure) {
            setError(String(failure).includes('INVALID_PROXY_SETTINGS') ? 'options.proxyInvalid' : 'options.proxySaveError');
            setStatus('idle');
        }
    };
    return <SettingsAnchor anchorId="proxySettings" label={t('options.proxySettings')} className="space-y-4">
        <SettingsSectionHeading icon={Globe} label={t('options.proxySettings')} />
        <div className={`border rounded-2xl p-5 space-y-5 text-left ${borderColor} ${settingsCardClass}`} style={{ color: 'var(--text-primary)' }}>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t('options.proxySettingsDesc')}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold">{t('options.proxyMode')}</span>
                <div className="w-full sm:w-52">
                    <CustomSelect value={draft.mode} ariaLabel={t('options.proxyMode')} disabled={!saved || status === 'saving'}
                        onChange={mode => edit({ ...draft, mode: mode as NetworkProxyMode })} isDaylight={isDaylight} theme={theme}
                        options={(['system', 'direct', 'custom'] as const).map(mode => ({ value: mode, label: t(`options.proxyMode_${mode}`) }))} />
                </div>
            </div>
            {draft.mode === 'custom' && <div className="space-y-2">
                <label htmlFor={inputId} className="block text-sm font-semibold">{t('options.proxyAddress')}</label>
                <input id={inputId} value={draft.address} placeholder="http://127.0.0.1:7897" disabled={status === 'saving'}
                    onChange={event => edit({ ...draft, address: event.target.value })} autoComplete="off" spellCheck={false}
                    aria-invalid={error === 'options.proxyInvalid'} aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
                    className={`w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-current/25 disabled:opacity-50 ${borderColor}`} />
                <p id={`${inputId}-hint`} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t('options.proxyAddressHint')}</p>
            </div>}
            {error && <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600 dark:text-red-300">{t(error)}</p>}
            <div className={`flex flex-wrap items-center justify-between gap-3 border-t pt-4 ${borderColor}`}>
                <p role="status" aria-live="polite" className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {status === 'loading' ? t('options.proxyLoading') : restartRequired || status === 'saved' ? t(restartRequired ? 'options.proxySavedRestart' : 'options.proxySaved') : t('options.proxyRestartHint')}
                </p>
                {!saved && status !== 'loading' ? <button type="button" onClick={() => setRetry(value => value + 1)} className="rounded-xl border px-4 py-2 text-sm">{t('options.proxyRetry')}</button>
                    : <button type="button" onClick={() => void save()} disabled={!dirty || status === 'saving' || status === 'loading'}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-black/10 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">
                        {status === 'saving' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        {status === 'saving' ? t('options.proxySaving') : t('options.save')}
                    </button>}
            </div>
        </div>
    </SettingsAnchor>;
}
