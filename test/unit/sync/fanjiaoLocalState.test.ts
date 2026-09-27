import { afterEach, describe, expect, it, vi } from 'vitest';
import { FanjiaoLocalState, FANJIAO_LOCAL_KEY } from '../../../src/services/sync/fanjiaoLocalState';
import { compareVersion, ZERO_VERSION } from '../../../shared/fanjiaoSync.mjs';
import type { SongResult } from '../../../src/types';

// Tests durable migration, clock rollback, independent opt-ins and live-session conflict handling.
const key = 'online:fanjiao:1';
const value = { position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90 };
const metadata = { name: 'One', albumId: '7', albumName: 'Album', coverUrl: '', author: '', kind: 'main' as const };
const song: SongResult = { id: '1', name: 'One', artists: [], album: { id: '7', name: 'Album' }, durationMs: 1200000,
    sourceRef: { kind: 'online', providerId: 'fanjiao', mediaId: '1' }, episode: { kind: 'main' } };
const memory = () => {
    const values = new Map<string, string>();
    return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('Fanjiao local journal', () => {
    it('migrates without changing listening time and persists stable versions across reloads', () => {
        const storage = memory();
        const state = new FanjiaoLocalState(storage, 'a', { [key]: value }, false, () => 5000);
        const data = state.export(true, true);
        expect(data.history?.records[0].value).toEqual(value);
        const restored = new FanjiaoLocalState(storage, 'a', {}, true);
        expect(restored.export(true, true)).toEqual(data);
        expect(state.export(false, true).history).toBeUndefined();
        expect(state.export(true, false).preference).toBeUndefined();
    });
    it('observes remote clocks and keeps subsequent operations newer after a local clock rollback', () => {
        const state = new FanjiaoLocalState(memory(), 'a', {}, true, () => 1);
        state.merge({ protocol: 1, history: { epoch: ZERO_VERSION, records: [{ key, epoch: ZERO_VERSION, generation: ZERO_VERSION,
            version: { counter: 900000, device: 'remote' }, deleted: false, value }] } });
        state.save(key, { ...value, position: 10, lastPlayedAt: 2 });
        expect(compareVersion(state.history.records[0].version, { counter: 900000, device: 'remote' })).toBeGreaterThan(0);
    });
    it('does not create a listening operation on pause/exit or metadata hydration', () => {
        const state = new FanjiaoLocalState(memory(), 'a', { [key]: value }, true);
        const version = state.history.records[0].version;
        state.save(key, { ...value, updatedAt: 9999 });
        state.hydrate(key, metadata);
        expect(state.history.records[0]).toMatchObject({ version, value: { ...value, metadata } });
    });
    it('isolates old target operations and preserves live local records on a target change', () => {
        const state = new FanjiaoLocalState(memory(), 'a', { [key]: value }, true);
        state.reset(key, null); state.clear();
        state.ensureScope('b', { 'online:fanjiao:2': value }, false);
        expect(state.history.epoch).toEqual(ZERO_VERSION);
        expect(state.history.records.map(row => row.key)).toEqual(['online:fanjiao:2']);
        expect(state.preference?.mainOnly).toBe(false);
    });
    it('retains unsent operations after a persistence failure for a later retry', () => {
        const storage = memory();
        const state = new FanjiaoLocalState(storage, 'a', { [key]: value }, true);
        const write = storage.setItem; storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
        expect(() => state.reset(key, null)).toThrow();
        storage.setItem = write;
        state.export(true, false);
        expect(new FanjiaoLocalState(storage, 'a', {}, true).history.records[0].deleted).toBe(true);
    });
});

async function storeFixture() {
    vi.resetModules();
    const storage = memory();
    storage.setItem('folia_episode_progress_v1', JSON.stringify({ [key]: value }));
    vi.stubGlobal('localStorage', storage);
    const module = await import('../../../src/stores/useEpisodePlaybackStore');
    return { storage, ...module };
}

describe('Fanjiao playback bridge', () => {
    it('defers a remote winner until session end, without uploading the next stale local save', async () => {
        const { useEpisodePlaybackStore } = await storeFixture();
        const store = useEpisodePlaybackStore.getState();
        const end = store.beginSession(key);
        const data = store.exportSyncData(true, false);
        const remote = { ...data.history!.records[0], version: { counter: Date.now() + 10000, device: 'remote' }, value: { ...value, position: 10 } };
        store.mergeSyncData({ protocol: 1, history: { epoch: ZERO_VERSION, records: [remote] } });
        expect(useEpisodePlaybackStore.getState().progress[key].position).toBe(627);
        store.saveProgress(key, { ...value, position: 700, updatedAt: Date.now(), lastPlayedAt: Date.now() });
        expect(store.exportSyncData(true, false).history!.records[0]).toEqual(remote);
        end();
        expect(useEpisodePlaybackStore.getState().progress[key].position).toBe(10);
    });
    it('recovers the journal winner after a crash between journal and legacy-cache writes', async () => {
        const { storage, useEpisodePlaybackStore } = await storeFixture();
        const store = useEpisodePlaybackStore.getState();
        store.beginSession(key);
        const remote = new FanjiaoLocalState(memory(), 'a', {}, true);
        remote.save(key, { ...value, position: 10, lastPlayedAt: 500 });
        store.mergeSyncData(remote.export(true, false));
        expect(JSON.parse(storage.getItem('folia_episode_progress_v1')!)[key].position).toBe(627);
        expect(storage.getItem(FANJIAO_LOCAL_KEY)).toBeTruthy();
        vi.resetModules();
        const restored = await import('../../../src/stores/useEpisodePlaybackStore');
        expect(restored.useEpisodePlaybackStore.getState().progress[key].position).toBe(10);
    });
    it('keeps a deletion through active flushes and reload, then permits explicit replay', async () => {
        const { useEpisodePlaybackStore, getEpisodeResumePosition } = await storeFixture();
        const store = useEpisodePlaybackStore.getState();
        const end = store.beginSession(key);
        store.deleteEpisode(key);
        store.saveProgress(key, { ...value, position: 700 }); end();
        expect(useEpisodePlaybackStore.getState().progress[key]).toBeUndefined();
        store.restartEpisode(song); getEpisodeResumePosition(song);
        store.saveProgress(key, { ...value, position: 5 });
        expect(store.exportSyncData(true, false).history!.records[0]).toMatchObject({ deleted: false, value: { position: 5 } });
    });
    it('exports hydrated legacy metadata without changing the operation or listening date', async () => {
        const { useEpisodePlaybackStore } = await storeFixture();
        const store = useEpisodePlaybackStore.getState();
        const version = store.exportSyncData(true, false).history!.records[0].version;
        store.hydrateMetadata([song]);
        expect(store.exportSyncData(true, false).history!.records[0]).toMatchObject({ version, value: { lastPlayedAt: 90, metadata: { albumId: '7' } } });
    });
    it('retains sync records beyond the 2000-entry display cache without creating deletions', async () => {
        const { useEpisodePlaybackStore } = await storeFixture();
        const store = useEpisodePlaybackStore.getState();
        const template = store.exportSyncData(true, false).history!.records[0];
        store.mergeSyncData({ protocol: 1, history: { epoch: ZERO_VERSION, records: Array.from({ length: 2001 }, (_, n) =>
            ({ ...template, key: `online:fanjiao:${n + 1}`, value: { ...value, lastPlayedAt: n + 1 } })) } });
        expect(Object.keys(useEpisodePlaybackStore.getState().progress)).toHaveLength(2000);
        const data = store.exportSyncData(true, false);
        expect(data.history!.records).toHaveLength(2001);
        expect(data.history!.records.some(row => row.deleted)).toBe(false);
        store.clearHistory('fanjiao');
        expect(store.exportSyncData(true, false).history!.records).toEqual([]);
    });
});
