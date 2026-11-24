import type { FanjiaoClient } from './client';
import type { FanjiaoRecord } from './normalize';

// sources/fanjiao/main/episodeInfoCache.ts
// 主进程内短时共享分集详情；播放授权不落盘，强制取源跳过旧缓存，各订阅者独立取消。

interface Entry {
    controller: AbortController;
    settled: boolean;
    users: number;
    expiresAt: number;
    promise: Promise<FanjiaoRecord>;
}

export interface EpisodeInfoCache {
    get(
        route: string,
        params: Record<string, string | number>,
        signal?: AbortSignal,
        options?: { fresh?: boolean },
    ): Promise<FanjiaoRecord>;
    clear(): void;
}

export function createEpisodeInfoCache(
    client: Pick<FanjiaoClient, 'get'>,
    { now = Date.now, ttlMs = 10000, maxEntries = 32 }: { now?: () => number; ttlMs?: number; maxEntries?: number } = {},
): EpisodeInfoCache {
    const entries = new Map<string, Entry>();
    const pending = new Set<Entry>();
    let disposed = false;
    const abortError = (signal?: AbortSignal): Error => (
        signal?.reason instanceof Error ? signal.reason : new DOMException('Cancelled', 'AbortError')
    );
    const remove = (key: string, entry: Entry) => { if (entries.get(key) === entry) entries.delete(key); };

    function subscribe(key: string, entry: Entry, signal?: AbortSignal): Promise<FanjiaoRecord> {
        entry.users++;
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (callback: () => void) => {
                if (done) return;
                done = true;
                signal?.removeEventListener('abort', abort);
                entry.users--;
                if (!entry.settled && entry.users === 0) { remove(key, entry); entry.controller.abort(); }
                callback();
            };
            const abort = () => finish(() => reject(abortError(signal)));
            signal?.addEventListener('abort', abort, { once: true });
            void entry.promise.then(
                value => finish(() => resolve(value)),
                (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error('Fanjiao detail request failed'))),
            );
            if (signal?.aborted) abort();
        });
    }

    return {
        get(route, params, signal, options) {
            if (disposed) return Promise.reject(new Error('Fanjiao detail cache disposed'));
            if (route !== '/walkman/api/audio/info') return client.get(route, params, signal);
            if (signal?.aborted) return Promise.reject(abortError(signal));
            const key = JSON.stringify(params);
            let entry = entries.get(key);
            if (options?.fresh || !entry || entry.controller.signal.aborted || (entry.settled && entry.expiresAt <= now())) {
                const controller = new AbortController();
                const created: Entry = {
                    controller, settled: false, users: 0, expiresAt: 0,
                    promise: Promise.resolve().then(() => {
                        controller.signal.throwIfAborted();
                        return client.get(route, params, controller.signal);
                    }).then(value => {
                        const authSeconds = Number(value.auth_timeout);
                        const lifetime = authSeconds > 0 ? Math.max(0, authSeconds * 1000 - 1000) : ttlMs;
                        created.expiresAt = now() + Math.min(ttlMs, lifetime);
                        return value;
                    }).catch((error: unknown) => { remove(key, created); throw error; })
                        .finally(() => { created.settled = true; pending.delete(created); }),
                };
                pending.add(created);
                if (entries.size >= maxEntries) {
                    const oldest = entries.keys().next().value;
                    if (oldest !== undefined) entries.delete(oldest);
                }
                entries.set(key, created);
                entry = created;
            }
            return subscribe(key, entry, signal);
        },
        clear() {
            disposed = true;
            for (const entry of pending) entry.controller.abort();
            pending.clear(); entries.clear();
        },
    };
}
