import { useEpisodePlaybackStore } from '../../stores/useEpisodePlaybackStore';
import { getSyncConfig, isSyncConfigured, setFanjiaoSyncStatus } from './syncConfig';
import { exchangeFanjiaoData, fanjiaoSyncError } from './fanjiaoSyncExchange';
import type { SyncProviderConfig } from './syncTypes';

// Manual only: startup theme sync and the five-second recorder do not call this coordinator.
let running = false;
export const canSyncFanjiao = (config = getSyncConfig()) => isSyncConfigured(config) && Boolean(config.fanjiaoHistory || config.fanjiaoPreference);
const identity = (config: SyncProviderConfig) => JSON.stringify([config.workerBaseUrl, config.authToken, config.fanjiaoScope]);

export async function syncFanjiaoNow() {
    const config = getSyncConfig();
    if (running || !canSyncFanjiao(config)) return null;
    const originalIdentity = identity(config);
    const sameIdentity = () => originalIdentity === identity(getSyncConfig());
    const ensureCurrent = () => {
        const current = getSyncConfig();
        if (!sameIdentity() || !current.enabled || current.fanjiaoHistory !== config.fanjiaoHistory
            || current.fanjiaoPreference !== config.fanjiaoPreference) throw new Error('fanjiaoSyncChanged');
    };
    running = true;
    try {
        setFanjiaoSyncStatus({ state: 'syncing', lastError: null });
        const local = useEpisodePlaybackStore.getState().exportSyncData(Boolean(config.fanjiaoHistory), Boolean(config.fanjiaoPreference));
        const remote = await exchangeFanjiaoData(config, local, ensureCurrent);
        ensureCurrent();
        useEpisodePlaybackStore.getState().mergeSyncData(remote);
        const result = { uploaded: local.history?.records.length ?? 0, downloaded: remote.history?.records.length ?? 0 };
        setFanjiaoSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
        return result;
    } catch (error) {
        if (sameIdentity()) setFanjiaoSyncStatus({ state: 'error', lastError: fanjiaoSyncError(error) });
        return null;
    } finally { running = false; }
}
