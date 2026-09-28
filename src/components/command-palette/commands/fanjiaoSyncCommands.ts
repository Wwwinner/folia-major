import { canSyncFanjiao, syncFanjiaoNow } from '../../../services/sync/fanjiaoSyncCoordinator';
import { getFanjiaoSyncStatus } from '../../../services/sync/syncConfig';
import { defineCommand } from '../commandFactories';

// The manual history sync command shares the settings button's availability guard.
export const fanjiaoSyncCommands = [
    defineCommand({ id: 'sync-fanjiao-now', group: 'settings', title: 'Sync Fanjiao data', description: 'Sync Fanjiao listening history and resume positions',
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
];
