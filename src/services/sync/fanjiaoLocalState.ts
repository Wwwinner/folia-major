import { isFanjiaoKey, mergeFanjiaoHistory, mergeFanjiaoPreference, parseEpisodeValue,
    parseFanjiaoSyncData, MAX_FANJIAO_RECORDS, ZERO_VERSION } from '../../../shared/fanjiaoSync.mjs';
import type { EpisodeMetadata, EpisodeValue, FanjiaoHistory, FanjiaoPreference, FanjiaoSyncData, SyncVersion } from '../../../shared/fanjiaoSync.mjs';
import { createSyncIdentity } from './syncConfig';

// Durable operation journal. Cache eviction never deletes sync records; clear is the only tombstone compaction.
export const FANJIAO_LOCAL_KEY = 'folia_fanjiao_sync_v1';
type Persistence = Pick<Storage, 'getItem' | 'setItem'>;
type Legacy = Record<string, EpisodeValue>;
export class FanjiaoLocalState {
    history: FanjiaoHistory = { epoch: ZERO_VERSION, records: [] };
    preference: FanjiaoPreference | null = null;
    private device = createSyncIdentity();
    private clock = 0;
    private scope: string;

    constructor(private storage: Persistence | null, scope: string, legacy: Legacy, mainOnly: boolean, private now = Date.now) {
        this.scope = scope;
        const raw = storage?.getItem(FANJIAO_LOCAL_KEY);
        if (raw) {
            try {
                const saved = JSON.parse(raw);
                const data = parseFanjiaoSyncData(saved.data, MAX_FANJIAO_RECORDS);
                if (saved.schema === 1 && data?.history && typeof saved.scope === 'string'
                    && typeof saved.device === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(saved.device)) {
                    this.scope = saved.scope; this.device = saved.device; this.history = data.history;
                    this.preference = data.preference ?? null;
                    this.observe();
                    this.ensureScope(scope, legacy, mainOnly);
                    return;
                }
            } catch { /* Keep the v1 playback records as migration fallback. */ }
        }
        this.seed(legacy, mainOnly);
    }

    private seed(legacy: Legacy, mainOnly: boolean) {
        this.history = { epoch: ZERO_VERSION, records: [] };
        for (const [key, value] of Object.entries(legacy)) {
            const parsed = isFanjiaoKey(key) && parseEpisodeValue(value);
            if (!parsed) continue;
            // Migration retains the old event time; opening the app is never a new listening event.
            const version = { counter: Math.max(1, Math.trunc(value.updatedAt)), device: this.device };
            this.history.records.push({ key, epoch: ZERO_VERSION, generation: ZERO_VERSION, version, deleted: false, value: parsed });
        }
        this.preference = { version: { counter: 1, device: this.device }, mainOnly };
        if (this.history.records.length > MAX_FANJIAO_RECORDS) throw new Error('fanjiaoSyncCapacity');
        this.observe();
    }

    ensureScope(scope: string, legacy: Legacy, mainOnly: boolean) {
        if (scope === this.scope) return;
        this.scope = scope;
        // A different server/identity starts from live local values, never old cursors or deletion operations.
        this.seed(legacy, mainOnly);
        this.flush();
    }

    private observe() {
        this.clock = Math.max(this.clock, this.history.epoch.counter, this.preference?.version.counter ?? 0,
            ...this.history.records.map(row => Math.max(row.version.counter, row.generation.counter)));
    }

    private next(): SyncVersion {
        this.clock = Math.max(this.clock + 1, Math.trunc(this.now()));
        return { counter: this.clock, device: this.device };
    }

    flush() {
        if (!this.storage) throw new Error('fanjiaoSyncStorageUnavailable');
        this.storage.setItem(FANJIAO_LOCAL_KEY, JSON.stringify({ schema: 1, scope: this.scope, device: this.device,
            data: { protocol: 1, history: this.history, preference: this.preference } }));
    }

    save(key: string, value: EpisodeValue, revive = false) {
        if (!isFanjiaoKey(key)) return;
        const parsed = parseEpisodeValue(value);
        if (!parsed) throw new Error('fanjiaoSyncInvalidData');
        const previous = this.history.records.find(row => row.key === key);
        if (previous?.deleted && !revive) return;
        if (!previous && this.history.records.length >= MAX_FANJIAO_RECORDS) throw new Error('fanjiaoSyncCapacity');
        if (previous?.value && previous.value.position === parsed.position && previous.value.duration === parsed.duration
            && previous.value.completed === parsed.completed && previous.value.lastPlayedAt === parsed.lastPlayedAt) {
            // Pausing/exiting and metadata hydration do not create a new listening operation.
            if (!previous.value.metadata && parsed.metadata) { previous.value = { ...previous.value, metadata: parsed.metadata }; this.flush(); }
            return;
        }
        const version = this.next();
        const generation = previous?.deleted || (previous?.value?.completed && !parsed.completed) ? version : previous?.generation ?? ZERO_VERSION;
        this.history = mergeFanjiaoHistory(this.history, { epoch: this.history.epoch, records: [
            { key, epoch: this.history.epoch, generation, version, deleted: false, value: parsed },
        ] });
        this.flush();
    }

    reset(key: string, value: EpisodeValue | null) {
        if (!isFanjiaoKey(key)) return;
        if (!this.history.records.some(row => row.key === key) && this.history.records.length >= MAX_FANJIAO_RECORDS) throw new Error('fanjiaoSyncCapacity');
        const version = this.next();
        const parsed = value && parseEpisodeValue(value);
        if (value && !parsed) throw new Error('fanjiaoSyncInvalidData');
        this.history = mergeFanjiaoHistory(this.history, { epoch: this.history.epoch, records: [
            { key, epoch: this.history.epoch, generation: version, version, deleted: !value, value: parsed },
        ] });
        this.flush();
    }

    clear() {
        this.history = { epoch: this.next(), records: [] };
        this.flush();
    }

    setPreference(mainOnly: boolean) {
        this.preference = { version: this.next(), mainOnly };
        this.flush();
    }

    hydrate(key: string, metadata: EpisodeMetadata) {
        const record = this.history.records.find(row => row.key === key);
        if (!record?.value || record.value.metadata) return;
        const value = parseEpisodeValue({ ...record.value, metadata });
        if (value) { record.value = value; this.flush(); }
    }

    merge(data: FanjiaoSyncData) {
        const history = data.history ? mergeFanjiaoHistory(this.history, data.history) : this.history;
        if (history.records.length > MAX_FANJIAO_RECORDS) throw new Error('fanjiaoSyncCapacity');
        this.history = history;
        if (data.preference !== undefined) this.preference = mergeFanjiaoPreference(this.preference, data.preference);
        this.observe();
        this.flush();
    }

    export(history: boolean, preference: boolean): FanjiaoSyncData {
        this.flush();
        return { protocol: 1, ...(history ? { history: structuredClone(this.history) } : {}),
            ...(preference ? { preference: this.preference && { ...this.preference, version: { ...this.preference.version } } } : {}) };
    }
}
