import type { FoliumLogger, FoliumSourceSong, FoliumStorage } from '@folia/folium';
import type { FanjiaoHistoryEntry } from '../contracts';

export interface FanjiaoHistory {
    list: () => Promise<readonly FanjiaoHistoryEntry[]>;
    record(song: FoliumSourceSong, position: number, duration: number, completed: boolean): void;
}

// The most recent checkpoint still worth resuming: unfinished and past the start.
export function latestResume(entries: readonly FanjiaoHistoryEntry[]): FanjiaoHistoryEntry | undefined {
    let latest: FanjiaoHistoryEntry | undefined;
    for (const entry of entries) {
        if (entry.completed || entry.position <= 0) continue;
        if (!latest || entry.listenedAt > latest.listenedAt) latest = entry;
    }
    return latest;
}

// 用模组独立存储保留最近收听位置；不读写旧版的宿主或同步数据。
export function createFanjiaoHistory(storage: FoliumStorage, log: FoliumLogger): FanjiaoHistory {
    const key = 'episodeHistory';
    const limit = 200;
    let loaded: Promise<FanjiaoHistoryEntry[]> | undefined;
    let pending = Promise.resolve();
    const load = () => loaded ??= storage.get<FanjiaoHistoryEntry[]>(key).then(value => value ?? [], (error: unknown) => {
        loaded = undefined;
        throw error;
    });

    return {
        async list(): Promise<readonly FanjiaoHistoryEntry[]> {
            await pending;
            return load();
        },
        record(song: FoliumSourceSong, position: number, duration: number, completed: boolean) {
            const album = song.album;
            if (!album) return;
            const entry: FanjiaoHistoryEntry = {
                id: song.id,
                albumId: album.id,
                albumTitle: album.name,
                title: song.title,
                coverUrl: album.coverUrl ?? song.coverUrl,
                position,
                duration,
                completed,
                listenedAt: Date.now(),
            };
            pending = pending.then(async () => {
                const previous = await load();
                const old = previous.find(item => item.id === entry.id);
                if (!old && !completed && position <= 0) return;
                if (old?.position === position && old.completed === completed) return;
                const updated = previous.filter(item => item.id !== entry.id).slice(0, limit - 1);
                updated.unshift(entry);
                await storage.set(key, updated);
                loaded = Promise.resolve(updated);
            }).catch((error: unknown) => log.warn('[Fanjiao] Could not save listening history', error));
        },
    };
}
