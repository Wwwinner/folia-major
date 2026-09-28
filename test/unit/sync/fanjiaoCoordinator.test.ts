import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZERO_VERSION } from '../../../shared/fanjiaoSync.mjs';

// Failure and history-only sync checks use the real coordinator, store and config persistence.
const key = 'online:fanjiao:1';
const value = { position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90 };
const history = { protocol: 1, history: { epoch: ZERO_VERSION, records: [] }, cursor: null };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
async function fixture() {
    vi.resetModules();
    const values = new Map<string, string>([['folia_episode_progress_v1', JSON.stringify({ [key]: value })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    const config = await import('../../../src/services/sync/syncConfig');
    config.saveSyncConfig({ provider: 'sync-server', enabled: true, workerBaseUrl: 'https://sync.example.com', authToken: 'fixture-token' });
    const store = (await import('../../../src/stores/useEpisodePlaybackStore')).useEpisodePlaybackStore;
    const coordinator = await import('../../../src/services/sync/fanjiaoSyncCoordinator');
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/health')) return response({ ok: true, capabilities: { fanjiaoSync: 1 } });
        if (init?.method === 'POST' || init?.method === 'PUT') return response({ ok: true, protocol: 1 });
        if (url.endsWith('/history')) return response(history);
        return response({ protocol: 1, preference: { version: { counter: 1000, device: 'remote' }, mainOnly: false } });
    });
    vi.stubGlobal('fetch', fetcher);
    return { values, config, store, coordinator, fetcher };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('manual Fanjiao sync coordinator', () => {
    it('never uploads on local saves and still requires the sync service to be enabled', async () => {
        const f = await fixture();
        f.store.getState().saveProgress(key, { ...value, position: 700 });
        expect(f.fetcher).not.toHaveBeenCalled();
        f.config.saveSyncConfig({ ...f.config.getSyncConfig(), enabled: false });
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        expect(f.fetcher).not.toHaveBeenCalled();
        expect(f.config.getSyncStatus().state).toBe('idle');
    });
    it('syncs history directly even when legacy category flags are off, without transmitting preferences', async () => {
        const f = await fixture();
        f.values.set('folia_sync_config_v1', JSON.stringify({ ...f.config.getSyncConfig(), fanjiaoHistory: false, fanjiaoPreference: true }));
        await f.coordinator.syncFanjiaoNow();
        expect(f.fetcher.mock.calls.map(call => call[0])).toContain('https://sync.example.com/fanjiao/history');
        expect(f.store.getState().progress[key]).toEqual(value);
        expect(f.store.getState().mainOnly).toBe(true);
        expect(f.config.getSyncConfig()).not.toHaveProperty('fanjiaoHistory');
        expect(f.config.getSyncConfig()).not.toHaveProperty('fanjiaoPreference');
        expect(f.fetcher.mock.calls.some(call => call[0].endsWith('/preference'))).toBe(false);
        expect(f.fetcher.mock.calls.filter(call => call[1]?.body).every(call => !String(call[1]!.body).includes('preference'))).toBe(true);
    });
    it('gives an upgrade result for an old server without issuing new-category requests', async () => {
        const f = await fixture();
        f.fetcher.mockResolvedValue(response({ ok: true, schemaVersion: 1 }));
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        expect(f.fetcher).toHaveBeenCalledTimes(1);
        expect(f.config.getFanjiaoSyncStatus()).toMatchObject({ state: 'error', lastError: 'fanjiaoSyncUpgrade' });
        expect(f.config.getSyncStatus().state).toBe('idle');
    });
    it('retains the same unsent operation versions on network failure and retries idempotently', async () => {
        const f = await fixture();
        const snapshot = f.store.getState().exportSyncData();
        f.fetcher.mockImplementationOnce(async () => response({ ok: true, capabilities: { fanjiaoSync: 1 } }))
            .mockRejectedValueOnce(new TypeError('network down'));
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        expect(f.store.getState().exportSyncData()).toEqual(snapshot);
        expect(await f.coordinator.syncFanjiaoNow()).not.toBeNull();
        const writes = f.fetcher.mock.calls.filter(call => call[1]?.method === 'POST');
        expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
    });
    it('deduplicates concurrent clicks', async () => {
        const f = await fixture();
        let resume!: () => void; const gate = new Promise<void>(resolve => { resume = resolve; });
        f.fetcher.mockImplementationOnce(async () => { await gate; return response({ ok: true, capabilities: { fanjiaoSync: 1 } }); });
        const first = f.coordinator.syncFanjiaoNow();
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        resume(); await first;
        expect(f.fetcher.mock.calls.filter(call => call[0].endsWith('/health'))).toHaveLength(1);
    });
    it('discards late responses and scopes operations when the server identity changes', async () => {
        const f = await fixture();
        const scope = f.config.getSyncConfig().fanjiaoScope;
        f.fetcher.mockImplementationOnce(async () => {
            f.config.saveSyncConfig({ ...f.config.getSyncConfig(), authToken: 'other-token' });
            return response({ ok: true, capabilities: { fanjiaoSync: 1 } });
        });
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        expect(f.fetcher).toHaveBeenCalledTimes(1);
        expect(f.config.getSyncConfig().fanjiaoScope).not.toBe(scope);
        expect(f.config.getFanjiaoSyncStatus().state).toBe('idle');
    });
    it('rejects malformed downloads without changing local history', async () => {
        const f = await fixture();
        f.fetcher.mockImplementation(async (url, init) => {
            if (url.endsWith('/health')) return response({ ok: true, capabilities: { fanjiaoSync: 1 } });
            if (init?.method === 'POST') return response({ ok: true, protocol: 1 });
            return response({ ...history, cursor: 'stuck-cursor' });
        });
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        expect(f.store.getState().progress[key]).toEqual(value);
        expect(f.config.getFanjiaoSyncStatus().lastError).toBe('fanjiaoSyncInvalidData');
    });
    it('recovers a syncing status left by an interrupted application', async () => {
        const f = await fixture();
        f.values.set('folia_fanjiao_sync_status_v1', JSON.stringify({ state: 'syncing', lastError: null, lastSyncAt: null }));
        vi.resetModules();
        const config = await import('../../../src/services/sync/syncConfig');
        expect(config.getFanjiaoSyncStatus().state).toBe('idle');
    });
    it('stops before the next request when the sync service is disabled mid-sync', async () => {
        const f = await fixture();
        f.fetcher.mockImplementationOnce(async () => {
            f.config.saveSyncConfig({ ...f.config.getSyncConfig(), enabled: false });
            return response({ ok: true, capabilities: { fanjiaoSync: 1 } });
        });
        expect(await f.coordinator.syncFanjiaoNow()).toBeNull();
        expect(f.fetcher).toHaveBeenCalledTimes(1);
        expect(f.store.getState().progress[key]).toEqual(value);
    });
    it('keeps deletion operations when upgrading an existing config without a scope', async () => {
        const f = await fixture();
        f.values.set('folia_sync_config_v1', JSON.stringify({ provider: 'sync-server', enabled: true,
            workerBaseUrl: 'https://sync.example.com', authToken: 'fixture-token' }));
        vi.resetModules();
        const config = await import('../../../src/services/sync/syncConfig');
        const store = (await import('../../../src/stores/useEpisodePlaybackStore')).useEpisodePlaybackStore;
        store.getState().deleteEpisode(key);
        config.saveSyncConfig(config.getSyncConfig());
        expect(store.getState().exportSyncData().history!.records[0].deleted).toBe(true);
        expect(config.getSyncConfig().fanjiaoScope).toBe('local');
    });
});
