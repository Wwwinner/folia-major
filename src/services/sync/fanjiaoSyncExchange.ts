import { compareVersion, isFanjiaoKey, MAX_FANJIAO_BATCH, MAX_FANJIAO_RECORDS, parseFanjiaoSyncData } from '../../../shared/fanjiaoSync.mjs';
import type { FanjiaoHistory, FanjiaoSyncData } from '../../../shared/fanjiaoSync.mjs';
import type { SyncProviderConfig, WorkerHealthResponse } from './syncTypes';
import { requestJson, SyncClientError } from './syncClient';

// HTTP exchange is independent of stores so two isolated clients can exercise the same production protocol.
export async function exchangeFanjiaoData(config: SyncProviderConfig, local: FanjiaoSyncData, ensureCurrent: () => void): Promise<FanjiaoSyncData> {
    const request = async <T,>(path: string, method = 'GET', data?: unknown): Promise<T> => {
        ensureCurrent();
        const result = await requestJson<T>(config, path, { method, signal: AbortSignal.timeout(30000),
            ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        ensureCurrent();
        return result;
    };
    const health = await request<WorkerHealthResponse>('/health');
    if (!health?.ok || health.capabilities?.fanjiaoSync !== 1) throw new Error('fanjiaoSyncUpgrade');
    const remote: FanjiaoSyncData = { protocol: 1 };
    if (local.history) {
        for (let offset = 0; offset < Math.max(1, local.history.records.length); offset += MAX_FANJIAO_BATCH) {
            const response = await request<{ ok?: boolean; protocol?: number }>('/fanjiao/history', 'POST', { protocol: 1,
                history: { epoch: local.history.epoch, records: local.history.records.slice(offset, offset + MAX_FANJIAO_BATCH) } });
            if (response?.ok !== true || response.protocol !== 1) throw new Error('fanjiaoSyncInvalidData');
        }
        let cursor: string | null = null;
        let history: FanjiaoHistory | undefined;
        let restarts = 0;
        do {
            const response: { cursor: unknown } = await request(`/fanjiao/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
            const parsed = parseFanjiaoSyncData(response);
            if (!parsed?.history || parsed.preference !== undefined || (response.cursor !== null && !isFanjiaoKey(response.cursor))) throw new Error('fanjiaoSyncInvalidData');
            if (history && compareVersion(history.epoch, parsed.history.epoch) !== 0) {
                if (++restarts > 3) throw new Error('fanjiaoSyncChanged');
                cursor = null; history = undefined; continue;
            }
            history ??= { epoch: parsed.history.epoch, records: [] };
            for (const row of parsed.history.records) {
                const last = history.records.at(-1)?.key;
                if (last && row.key <= last) throw new Error('fanjiaoSyncInvalidData');
                history.records.push(row);
            }
            if (history.records.length > MAX_FANJIAO_RECORDS || (response.cursor !== null
                && (response.cursor !== parsed.history.records.at(-1)?.key || (cursor && response.cursor <= cursor)))) throw new Error('fanjiaoSyncInvalidData');
            cursor = response.cursor;
        } while (cursor !== null || !history);
        remote.history = history;
    }
    if (local.preference !== undefined) {
        if (local.preference) {
            const response = await request<{ ok?: boolean; protocol?: number }>('/fanjiao/preference', 'PUT', { protocol: 1, preference: local.preference });
            if (response?.ok !== true || response.protocol !== 1) throw new Error('fanjiaoSyncInvalidData');
        }
        const parsed = parseFanjiaoSyncData(await request('/fanjiao/preference'));
        if (!parsed || parsed.preference === undefined || parsed.history !== undefined) throw new Error('fanjiaoSyncInvalidData');
        remote.preference = parsed.preference;
    }
    return remote;
}

export function fanjiaoSyncError(error: unknown) {
    if (error instanceof SyncClientError) {
        if (error.status === 401 || error.status === 403) return 'fanjiaoSyncAuth';
        if (error.status === 404) return 'fanjiaoSyncUpgrade';
        if (error.status === 409) return 'fanjiaoSyncCapacity';
        if (error.status === 400 || error.status === 413) return 'fanjiaoSyncInvalidData';
    }
    if (error instanceof Error && /^fanjiaoSync(?:Upgrade|InvalidData|Capacity|Changed|StorageUnavailable)$/.test(error.message)) return error.message;
    if (error instanceof Error && error.name === 'QuotaExceededError') return 'fanjiaoSyncStorageUnavailable';
    return 'fanjiaoSyncNetwork';
}
