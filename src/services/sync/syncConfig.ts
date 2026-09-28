import { SYNC_PROVIDER, type SyncProviderConfig, type SyncRuntimeStatus } from './syncTypes';

// src/services/sync/syncConfig.ts
// Local persistence for user-owned sync server settings and runtime status.

const SYNC_CONFIG_STORAGE_KEY = 'folia_sync_config_v1';
const SYNC_STATUS_STORAGE_KEY = 'folia_sync_status_v1';
const SYNC_CONFIG_EVENT = 'folia-sync-config-changed';
const SYNC_STATUS_EVENT = 'folia-sync-status-changed';
const FANJIAO_STATUS_KEY = 'folia_fanjiao_sync_status_v1';

const DEFAULT_CONFIG: SyncProviderConfig = {
    provider: SYNC_PROVIDER,
    enabled: false,
    workerBaseUrl: '',
    authToken: '',
    fanjiaoScope: '',
};

const DEFAULT_STATUS: SyncRuntimeStatus = {
    state: 'idle',
    lastSyncAt: null,
    lastError: null,
};

const isBrowser = () => typeof window !== 'undefined';

// Device IDs are not credentials. getRandomValues also works on HTTP-hosted web clients.
export const createSyncIdentity = () => globalThis.crypto?.randomUUID?.()
    ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');

const readJson = <T,>(key: string, fallback: T): T => {
    if (!isBrowser()) {
        return fallback;
    }

    try {
        const stored = window.localStorage?.getItem(key);
        if (!stored) return fallback;
        const value = JSON.parse(stored);
        return value && typeof value === 'object' && !Array.isArray(value) ? value as T : fallback;
    } catch {
        return fallback;
    }
};

const emitEvent = (eventName: string) => {
    if (isBrowser()) {
        window.dispatchEvent(new Event(eventName));
    }
};

export const getSyncConfig = (): SyncProviderConfig => {
    const stored = readJson<Partial<SyncProviderConfig>>(SYNC_CONFIG_STORAGE_KEY, {});
    return {
        ...DEFAULT_CONFIG,
        provider: SYNC_PROVIDER,
        workerBaseUrl: typeof stored.workerBaseUrl === 'string' ? stored.workerBaseUrl.trim() : '',
        authToken: typeof stored.authToken === 'string' ? stored.authToken.trim() : '',
        enabled: Boolean(stored.enabled),
        fanjiaoScope: typeof stored.fanjiaoScope === 'string' ? stored.fanjiaoScope : '',
    };
};

export const saveSyncConfig = (config: SyncProviderConfig) => {
    if (!isBrowser()) {
        return;
    }

    const previous = getSyncConfig();
    const workerBaseUrl = config.workerBaseUrl.trim().replace(/\/+$/, '');
    const authToken = config.authToken.trim();
    const identityChanged = workerBaseUrl !== previous.workerBaseUrl.replace(/\/+$/, '') || authToken !== previous.authToken;
    window.localStorage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify({
        provider: SYNC_PROVIDER,
        enabled: config.enabled,
        workerBaseUrl,
        authToken,
        fanjiaoScope: identityChanged ? createSyncIdentity() : previous.fanjiaoScope || 'local',
    }));
    if (identityChanged) setFanjiaoSyncStatus(DEFAULT_STATUS);
    emitEvent(SYNC_CONFIG_EVENT);
};

export const isSyncConfigured = (config = getSyncConfig()) => (
    config.enabled && Boolean(config.workerBaseUrl && config.authToken)
);

export const getSyncStatus = (): SyncRuntimeStatus => readJson(SYNC_STATUS_STORAGE_KEY, DEFAULT_STATUS);

let fanjiaoRuntimeStatus: SyncRuntimeStatus | null = null;
export const getFanjiaoSyncStatus = (): SyncRuntimeStatus => {
    if (!fanjiaoRuntimeStatus) {
        const saved = readJson<SyncRuntimeStatus>(FANJIAO_STATUS_KEY, DEFAULT_STATUS);
        fanjiaoRuntimeStatus = saved.state === 'syncing' ? { ...saved, state: 'idle' } : saved;
    }
    return fanjiaoRuntimeStatus;
};
export const setFanjiaoSyncStatus = (patch: Partial<SyncRuntimeStatus>) => {
    if (!isBrowser()) return;
    fanjiaoRuntimeStatus = { ...getFanjiaoSyncStatus(), ...patch };
    try { window.localStorage.setItem(FANJIAO_STATUS_KEY, JSON.stringify(fanjiaoRuntimeStatus)); }
    catch { /* Status persistence must not hide a recoverable data-storage failure. */ }
    emitEvent(SYNC_STATUS_EVENT);
};

export const setSyncStatus = (patch: Partial<SyncRuntimeStatus>) => {
    if (!isBrowser()) {
        return;
    }

    const next = {
        ...getSyncStatus(),
        ...patch,
    };
    window.localStorage.setItem(SYNC_STATUS_STORAGE_KEY, JSON.stringify(next));
    emitEvent(SYNC_STATUS_EVENT);
};

export const subscribeSyncConfig = (listener: () => void) => {
    if (!isBrowser()) {
        return () => undefined;
    }

    window.addEventListener(SYNC_CONFIG_EVENT, listener);
    return () => window.removeEventListener(SYNC_CONFIG_EVENT, listener);
};

export const subscribeSyncStatus = (listener: () => void) => {
    if (!isBrowser()) {
        return () => undefined;
    }

    window.addEventListener(SYNC_STATUS_EVENT, listener);
    return () => window.removeEventListener(SYNC_STATUS_EVENT, listener);
};
