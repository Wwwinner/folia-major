// 主进程内短时共享分集详情；播放授权不落盘，强制取源跳过旧缓存，各订阅者独立取消。
export function createEpisodeInfoCache(client, { now = Date.now, ttlMs = 10000, maxEntries = 32 } = {}) {
    const entries = new Map();
    const pending = new Set();
    let disposed = false;
    const remove = (key, entry) => { if (entries.get(key) === entry) entries.delete(key); };

    function subscribe(key, entry, signal) {
        entry.users++;
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (callback, value) => {
                if (done) return;
                done = true;
                signal?.removeEventListener('abort', abort);
                entry.users--;
                if (!entry.settled && entry.users === 0) { remove(key, entry); entry.controller.abort(); }
                callback(value);
            };
            const abort = () => finish(reject, signal.reason ?? new DOMException('Cancelled', 'AbortError'));
            signal?.addEventListener('abort', abort, { once: true });
            entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
            if (signal?.aborted) abort();
        });
    }

    return {
        get(route, params, ...args) {
            if (disposed) return Promise.reject(new Error('Fanjiao detail cache disposed'));
            if (route !== '/walkman/api/audio/info') return client.get(route, params, ...args);
            const [signal, options] = args;
            if (signal?.aborted) return Promise.reject(signal.reason);
            const key = JSON.stringify(params);
            let entry = entries.get(key);
            if (options?.fresh || !entry || entry.controller.signal.aborted || (entry.settled && entry.expiresAt <= now())) {
                entry = { controller: new AbortController(), settled: false, users: 0, expiresAt: 0, promise: null };
                const created = entry;
                pending.add(created);
                if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
                entries.set(key, created);
                created.promise = Promise.resolve().then(() => {
                    created.controller.signal.throwIfAborted();
                    return client.get(route, params, created.controller.signal);
                }).then(value => {
                    const authSeconds = Number(value.auth_timeout);
                    const lifetime = authSeconds > 0 ? Math.max(0, authSeconds * 1000 - 1000) : ttlMs;
                    created.expiresAt = now() + Math.min(ttlMs, lifetime);
                    return value;
                }).catch(error => { remove(key, created); throw error; })
                    .finally(() => { created.settled = true; pending.delete(created); });
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
