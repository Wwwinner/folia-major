import { describe, expect, it, vi } from 'vitest';
import { createFanjiaoDiscovery, homeSectionsDto } from '../../../electron/fanjiao/discovery.mjs';
import { rankedAlbums } from '../../../electron/fanjiao/rankings.mjs';
import { createFanjiaoClient } from '../../../electron/fanjiao/client.mjs';

// 榜单合同测试使用离线响应，覆盖五类指标、未知总数分页和固定请求边界。
const routes = [
    ['ranking-feeding', 2, 'feeding', 'feeding'], ['ranking-followers', 3, 'liked', 'followers'],
    ['ranking-popularity', 4, 'popularity', 'popularity'], ['ranking-new', 5, 'play', 'plays'],
    ['ranking-free', 6, 'play', 'plays'],
] as const;
const album = { album_id: 7, rank: 21, name: 'Drama', feeding: 0, liked: 123, popularity: 456, play: 789,
    square: 'https://example.com/cover.png', up_name: 'Studio', description: 'Intro', play_auth: 'private-value' };

describe('Fanjiao rankings', () => {
    it.each(routes)('routes %s with the official rank and matching metric', async (id, tab, field, metric) => {
        const get = vi.fn(async () => ({ list: [album], paging: { page: 2, page_size: 20, total: 0 } }));
        const discovery = createFanjiaoDiscovery(() => ({ get }));
        const page = await discovery.request('sectionAlbums', { id, limit: 20, offset: 20, time_type: 99, month: '2000-01' });
        expect(get).toHaveBeenCalledWith('/walkman/api/ranking/album', { tab, time_type: 1, page: 2, size: 20 });
        expect(page.items[0]).toMatchObject({ id: '7', publisher: 'Studio', ranking: { position: 21, value: album[field], metric } });
        expect(JSON.stringify(page)).not.toContain('private-value');
    });
    it('retains five homepage tabs and supports an empty known chart without guessing unknown routes', () => {
        const result = homeSectionsDto({ list: [{ modular_name: 'Charts', list: [
            ...routes.map(([, tab]) => ({ tab, name: `Chart ${tab}`, rank_list: [album] })),
            { tab: 99, name: 'Unknown', rank_list: [album] }, { tab: 2, name: 'Empty', rank_list: [] },
        ] }], paging: { page: 1, page_size: 20, total: 1 } }, { page: 1, limit: 20, offset: 0 });
        expect(result.items.slice(0, 5).map((item: any) => item.moreId)).toEqual(routes.map(([id]) => id));
        expect(result.items[0].items[0].ranking).toEqual({ position: 21, value: 0, metric: 'feeding' });
        expect(result.items[5].moreId).toBeUndefined();
        expect(result.items[6]).toMatchObject({ moreId: 'ranking-feeding', items: [] });
    });
    it.each([
        { total: 0, count: 2, offset: 0, more: true, expectedTotal: undefined },
        { total: 0, count: 2, offset: 2, more: true, expectedTotal: undefined },
        { total: 0, count: 1, offset: 2, more: false, expectedTotal: undefined },
        { total: 0, count: 0, offset: 4, more: false, expectedTotal: undefined },
        { total: 4, count: 2, offset: 2, more: false, expectedTotal: 4 },
        { total: 6, count: 2, offset: 2, more: true, expectedTotal: 6 },
        { total: 1, count: 2, offset: 2, more: true, expectedTotal: undefined },
    ])('handles pagination with $total total and $count items at $offset', async ({ total, count, offset, more, expectedTotal }) => {
        const discovery = createFanjiaoDiscovery(() => ({ get: async () => ({
            list: Array.from({ length: count }, (_, index) => ({ ...album, album_id: index + offset + 1, rank: index + offset + 1 })),
            paging: { page: offset / 2 + 1, page_size: 2, total },
        }) }));
        const page = await discovery.request('sectionAlbums', { id: 'ranking-feeding', limit: 2, offset });
        expect(page).toMatchObject({ total: expectedTotal, nextOffset: offset + 2, hasMore: more });
        expect(page.items).toHaveLength(count);
    });
    it('keeps missing scores unknown and filters malformed rows without replacing authoritative ranks', () => {
        const result = rankedAlbums([album, { ...album, rank: 0 }, { ...album, album_id: '../private' },
            { ...album, album_id: 8, rank: 23, feeding: -1 }], 'ranking-feeding');
        expect(result.map((item: any) => [item.id, item.ranking.position, item.ranking.value])).toEqual([['7', 21, 0], ['8', 23, undefined]]);
    });
    it('rejects unverified chart routes and wrong page responses', async () => {
        const get = vi.fn(async () => ({ list: [album], paging: { page: 1, page_size: 20, total: 100 } }));
        const discovery = createFanjiaoDiscovery(() => ({ get }));
        for (const id of ['ranking-total', 'ranking-history', 'ranking-live', '__proto__']) {
            await expect(discovery.request('sectionAlbums', { id })).rejects.toThrow('Unsupported');
        }
        expect(get).not.toHaveBeenCalled();
        await expect(discovery.request('sectionAlbums', { id: 'ranking-free', limit: 20, offset: 20 })).rejects.toThrow('pagination');
    });
    it('uses the verified App user agent through the production transport', async () => {
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ code: 0, data: {} })));
        vi.stubGlobal('fetch', fetchMock);
        try {
            await createFanjiaoClient('fixture-secret').get('/walkman/api/ranking/album', { tab: 2, time_type: 1, page: 1, size: 20 });
            expect(new Headers(fetchMock.mock.calls[0][1].headers).get('user-agent')).toBe('fanjiao/3.15.1 140 Android 15');
        } finally { vi.unstubAllGlobals(); }
    });
});
