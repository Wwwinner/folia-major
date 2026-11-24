import { describe, expect, it } from 'vitest';
import type { FoliumSourceSong } from '@/mods/folium/sources/contract';
import type { FoliumStorage } from '@/mods/folium/contract';
import { createFanjiaoHistory, latestResume } from '../../../sources/fanjiao/client/history';

// 重建 renderer 后继续使用同一个模组数据文件；已完成的集不能覆盖另一集的进度。
describe('饭角收听历史', () => {
    it('保留分集完成状态和重播前的进度归零', async () => {
        const stored = new Map<string, unknown>();
        const storage: FoliumStorage = {
            get: async <T>(key: string) => structuredClone(stored.get(key)) as T | undefined,
            set: async (key, value) => { stored.set(key, structuredClone(value)); },
            has: async key => stored.has(key),
            delete: async key => { stored.delete(key); },
            keys: async () => [...stored.keys()],
        };
        const history = createFanjiaoHistory(storage, console);
        const first: FoliumSourceSong = {
            id: '10', title: '第一集', artists: [], album: { id: '20', name: '广播剧' },
        };
        const second = { ...first, id: '11', title: '第二集' };
        history.record(first, 30, 60, false);
        history.record(second, 13.5, 120, false);
        await history.list();
        expect(await createFanjiaoHistory(storage, console).list()).toMatchObject([
            { id: second.id, albumId: '20', position: 13.5, completed: false },
            { id: first.id, albumId: '20', position: 30, completed: false },
        ]);
        history.record(first, 60, 60, true);
        history.record(second, 0, 120, false);
        await history.list();
        expect(await createFanjiaoHistory(storage, console).list()).toMatchObject([
            { id: second.id, albumId: '20', position: 0, completed: false },
            { id: first.id, albumId: '20', position: 60, completed: true },
        ]);
    });

    it('选择最近一条未听完且有进度的分集', () => {
        const entry = (id: string, position: number, completed: boolean, listenedAt: number) => ({
            id, albumId: '20', title: id, albumTitle: '广播剧', position, duration: 60, completed, listenedAt,
        });
        expect(latestResume([
            entry('done', 60, true, 400),
            entry('start', 0, false, 300),
            entry('older', 10, false, 100),
            entry('newer', 20, false, 200),
        ])?.id).toBe('newer');
        expect(latestResume([entry('done', 60, true, 400), entry('start', 0, false, 300)])).toBeUndefined();
    });
});
