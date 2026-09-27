import { canSyncFanjiao, syncFanjiaoNow } from '../../../services/sync/fanjiaoSyncCoordinator';
import { getFanjiaoSyncStatus, getSyncConfig, saveSyncConfig, setFanjiaoSyncStatus } from '../../../services/sync/syncConfig';
import { defineCommand } from '../commandFactories';

// Functional opt-ins have direct commands and share the settings UI's availability guard.
export const fanjiaoSyncCommands = [
    defineCommand({ id: 'sync-fanjiao-now', group: 'settings', title: 'Sync Fanjiao data', description: 'Manually sync selected Fanjiao data',
        keywords: ['fanjiao sync', '同步饭角数据', 'fjtb'], isAvailable: () => canSyncFanjiao() && getFanjiaoSyncStatus().state !== 'syncing',
        execute: async (_input, context) => {
            if (!canSyncFanjiao()) return false;
            const result = await syncFanjiaoNow();
            const status = getFanjiaoSyncStatus();
            context.shared.setStatusMsg({ type: result ? 'info' : 'error', text: result
                ? context.shared.t('ui.storage.fanjiaoSyncSuccess').replace('{{time}}', new Date(status.lastSyncAt!).toLocaleString())
                : context.shared.t(`ui.storage.${status.lastError || 'fanjiaoSyncNetwork'}`) });
            return true;
        } }),
    ...(['fanjiaoHistory', 'fanjiaoPreference'] as const).map((category, index) => defineCommand({
        id: index === 0 ? 'sync-fanjiao-history-toggle' : 'sync-fanjiao-preference-toggle', group: 'settings',
        title: index === 0 ? 'Toggle Fanjiao history sync' : 'Toggle Fanjiao preference sync',
        description: 'Choose data to sync on this device', keywords: ['fanjiao sync options', index === 0 ? '饭角收听记录同步' : '饭角播放偏好同步', 'fjtb'],
        execute: (_input, context) => {
            const config = getSyncConfig();
            try {
                saveSyncConfig({ ...config, [category]: !config[category] });
                context.shared.setStatusMsg({ type: 'info', text: context.shared.t('ui.storage.fanjiaoSyncChoiceSaved') });
            } catch {
                setFanjiaoSyncStatus({ state: 'error', lastError: 'fanjiaoSyncStorageUnavailable' });
                context.shared.setStatusMsg({ type: 'error', text: context.shared.t('ui.storage.fanjiaoSyncStorageUnavailable') });
            }
            return true;
        },
    })),
];
