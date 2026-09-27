import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canSyncFanjiao, syncFanjiaoNow } from '../../../services/sync/fanjiaoSyncCoordinator';
import { getFanjiaoSyncStatus, setFanjiaoSyncStatus, subscribeSyncStatus } from '../../../services/sync/syncConfig';
import type { SyncProviderConfig } from '../../../services/sync/syncTypes';

// Device-local category choices and manual sync results, separate from visual settings sync.
export default function FanjiaoSyncSettings({ config, busy, onChange, onSave }: {
    config: SyncProviderConfig; busy: boolean; onChange: (patch: Partial<SyncProviderConfig>) => void; onSave: () => void | boolean;
}) {
    const { t } = useTranslation();
    const [status, setStatus] = useState(getFanjiaoSyncStatus);
    useEffect(() => subscribeSyncStatus(() => setStatus(getFanjiaoSyncStatus())), []);
    const syncing = status.state === 'syncing';
    const run = async () => {
        try { if (onSave() === false) return; }
        catch { setFanjiaoSyncStatus({ state: 'error', lastError: 'fanjiaoSyncStorageUnavailable' }); return; }
        await syncFanjiaoNow();
    };
    return <fieldset className="space-y-3 border-t border-current/10 pt-4" data-testid="fanjiao-sync-settings" disabled={busy || syncing}>
        <legend className="px-1 text-sm font-medium">{t('ui.storage.fanjiaoSyncTitle')}</legend>
        <p className="text-xs opacity-65">{t('ui.storage.fanjiaoSyncDescription')}</p>
        {(['fanjiaoHistory', 'fanjiaoPreference'] as const).map(key => <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-current" checked={Boolean(config[key])} onChange={event => onChange({ [key]: event.target.checked })} />
            <span>{t(`ui.storage.${key}`)}<span className="mt-1 block text-xs opacity-65">{t(`ui.storage.${key}Hint`)}</span></span>
        </label>)}
        <button type="button" onClick={() => void run()} disabled={busy || syncing || !canSyncFanjiao(config)}
            className="flex items-center justify-center gap-2 rounded-lg bg-current/5 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-40">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{t('ui.storage.fanjiaoSyncNow')}
        </button>
        <p role={status.state === 'error' ? 'alert' : 'status'} className="text-xs opacity-75">
            {syncing ? t('ui.storage.fanjiaoSyncWorking') : status.state === 'error'
                ? t(`ui.storage.${status.lastError || 'fanjiaoSyncNetwork'}`) : status.lastSyncAt
                    ? t('ui.storage.fanjiaoSyncSuccess', { time: new Date(status.lastSyncAt).toLocaleString() })
                    : t('ui.storage.fanjiaoSyncIdle')}
        </p>
    </fieldset>;
}
