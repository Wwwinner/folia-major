import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { albumDto, episodeDto, hasEpisodeMediaAuthorization } from '../../../sources/fanjiao/main/catalog';
import { createFanjiaoClient, signFanjiaoGet, type FanjiaoClient, type FanjiaoFetch } from '../../../sources/fanjiao/main/client';
import { featuredPlaylists, fetchPlaylistAlbums } from '../../../sources/fanjiao/main/playlists';
import {
    fetchRecommendedCollections, recommendationAlbums, recommendationLimit,
} from '../../../sources/fanjiao/main/recommendations';

// test/unit/fanjiao/mainDiscovery.test.ts
// 饭角推荐、目录 DTO 和签名传输的离线边界；不读取真实凭据，也不发网络请求。

const album = {
    album_id: 7, name: 'Drama', square: 'https://example.com/square.png', cover: 'https://example.com/poster.png',
    horizontal: 'https://example.com/landscape.png', play: 0, new_audio_name: 'Episode 3',
    discount_name: 'Presale', play_auth: 'private-value', description: 'Intro', author_name: 'Writer', up_name: 'Studio',
    rank: 21,
};
const albumCovers = { square: album.square, portrait: album.cover, landscape: album.horizontal };

const homeModule = (name: string, type: number, list: unknown[]) => ({
    modular_name: name, type: 2, modular_style: 4,
    request_extras: { path: '/recommend/major', params: { type } }, list,
});
const popularModule = homeModule('热门速递', 1, [album, { ...album, album_id: 8, name: 'Second' }]);
const weeklyModule = homeModule('精品周更', 3,
    [{ ...album, album_id: 9, name: 'Weekly', square: 'https://example.com/weekly.png' }]);
const homePage = (pageNumber: number, total: number, modules: unknown[]) => ({
    paging: { page: pageNumber, page_size: 20, total }, list: modules,
});
const majorPage = (pageNumber: number, total: number, albums: unknown[]) => ({
    paging: { page: pageNumber, page_size: 20, total }, list: albums,
});

describe('Fanjiao catalog DTOs', () => {
    it('keeps the display fields, a real zero play count and no authorization', () => {
        const dto = albumDto(album);
        expect(dto).toEqual({ id: '7', name: 'Drama', coverUrl: 'https://example.com/square.png',
            coverVariants: albumCovers, description: 'Intro', author: 'Writer', publisher: 'Studio', playCount: 0 });
        expect(JSON.stringify(dto)).not.toContain('private-value');
        expect(albumDto({ album_id: 8, title: 'Title', cover_url: 'https://example.com/c.png' }))
            .toMatchObject({ name: 'Title', coverUrl: 'https://example.com/c.png', playCount: undefined });
    });

    it.each([undefined, '', '0', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('leaves an invalid play count unknown: %s', play => {
        expect(albumDto({ album_id: 7, play }).playCount).toBeUndefined();
        expect(episodeDto({ audio_id: 1, album_id: 2, play }).playCount).toBeUndefined();
    });

    it.each([
        ['javascript:alert(1)'], ['http://example.com/a.png'], ['https://user:password@example.com/a.png'], ['not a url'],
    ])('drops an unsafe cover: %s', cover => {
        expect(albumDto({ album_id: 7, square: cover }).coverUrl).toBe('');
        expect(albumDto({ album_id: 7, square: cover, cover: album.cover, horizontal: cover })).toMatchObject({
            coverUrl: album.cover, coverVariants: { square: undefined, landscape: undefined, portrait: album.cover },
        });
    });

    it('rejects malformed album and episode ids', () => {
        expect(() => albumDto({ album_id: '../private' })).toThrow('Invalid Fanjiao media ID');
        expect(() => episodeDto({ audio_id: 0, album_id: 2 })).toThrow('Invalid Fanjiao media ID');
    });

    it('preserves the main-episode marker and album fallbacks', () => {
        const albumDtoValue = albumDto(album);
        expect(episodeDto({ audio_id: 1, album_id: 2, is_positive: 1, name: 'Extra' }, albumDtoValue))
            .toMatchObject({ id: '1', albumId: '2', isPositive: 1, durationMs: 0, albumName: 'Drama',
                coverUrl: 'https://example.com/square.png', author: 'Writer' });
        expect(episodeDto({ audio_id: 1, album_id: 2, is_positive: 2 }).isPositive).toBe(2);
        expect(episodeDto({ audio_id: 1, album_id: 2, name: '第一集' }).isPositive).toBeNull();
        expect(episodeDto({ audio_id: 3, album_id: 4, duration: 90, play: 0 }))
            .toMatchObject({ durationMs: 90000, playCount: 0 });
    });

    it('requires both media authorization fields instead of inferring access from catalog flags', () => {
        expect(hasEpisodeMediaAuthorization({ play_auth: 'present', encrypt_src: 'video', is_public: 0 })).toBe(true);
        expect(hasEpisodeMediaAuthorization({ price: 0, is_public: 1 })).toBe(false);
        expect(hasEpisodeMediaAuthorization({ play_auth: 'present' })).toBe(false);
        expect(hasEpisodeMediaAuthorization({ play_auth: ' ', encrypt_src: 'video' })).toBe(false);
        expect(hasEpisodeMediaAuthorization({ play_auth: 'present', encrypt_src: ' ' })).toBe(false);
    });
});

describe('Fanjiao recommendation albums', () => {
    it('keeps real album DTOs in upstream module order and dedupes later duplicates', () => {
        const items = recommendationAlbums({ list: [
            { modular_name: '热门', list: [album, { ...album, album_id: 8, name: 'Second' }] },
            { modular_name: '重复', list: [album, { album_id: 0, name: 'Broken' }, { album_id: '../private' }] },
            { modular_name: '无列表', list: null },
            { modular_name: '榜单', list: [{ tab: 2, name: 'Chart', rank_list: [album] }] },
        ] });
        expect(items.map(item => item.id)).toEqual(['7', '8']);
        expect(items[0]).toMatchObject({ name: 'Drama', publisher: 'Studio', playCount: 0 });
        expect(JSON.stringify(items)).not.toContain('private-value');
        expect(JSON.stringify(items)).not.toContain('rank_list');
    });

    it('accepts verified album banners and ignores external or unsupported targets', () => {
        const banner = { banner_id: 4205, title: 'Campaign', type: 'album', cover: 'https://example.com/banner.png',
            extras: { path: '/index/drama_info', params: { album_id: 111734 } } };
        const items = recommendationAlbums({ list: [
            { modular_name: 'Banner', type: 1, modular_style: 2, list: [
                banner,
                { ...banner, banner_id: 4206, extras: undefined,
                    link: JSON.stringify({ path: '/index/drama_info', params: { album_id: 111735 } }) },
                { ...banner, banner_id: 4207, type: 'web' },
                { ...banner, banner_id: 4208, extras: undefined, link: 'https://example.com/promo' },
                { ...banner, banner_id: 4209, extras: { path: '/web', params: { album_id: 9 } } },
                { ...banner, banner_id: 4210, extras: { path: '/index/drama_info', params: { album_id: '0' } } },
            ] },
            { modular_name: 'Catalog', list: [{ ...album, album_id: 111734 }] },
        ] });
        expect(items.map(item => ({ id: item.id, name: item.name }))).toEqual([
            { id: '111734', name: 'Campaign' }, { id: '111735', name: 'Campaign' },
        ]);
        expect(items[0].coverUrl).toBe('https://example.com/banner.png');
        expect(items[0].coverVariants).toEqual(albumCovers);
        expect(items[1].coverVariants).toBeUndefined();
        expect(JSON.stringify(items)).not.toContain('/index/drama_info');
    });

    it('rejects a home payload without a list', () => {
        expect(() => recommendationAlbums({ list: null })).toThrow('Invalid Fanjiao recommendations');
        expect(() => recommendationAlbums({})).toThrow('Invalid Fanjiao recommendations');
        expect(recommendationAlbums({ list: [] })).toEqual([]);
    });
});

describe('Fanjiao featured playlist cards', () => {
    it('puts the two checked modules first with a child cover and no episode count', () => {
        const cards = featuredPlaylists({ list: [popularModule, weeklyModule] });
        expect(cards).toEqual([
            { kind: 'playlist', id: 'featured:popular', name: '热门速递',
                coverUrl: album.square, coverVariants: albumCovers, playlistContents: 'albums' },
            { kind: 'playlist', id: 'featured:weekly', name: '精品周更',
                coverUrl: 'https://example.com/weekly.png', coverVariants: { ...albumCovers, square: 'https://example.com/weekly.png' },
                playlistContents: 'albums' },
        ]);
        expect(JSON.stringify(cards)).not.toContain('trackCount');
        expect(JSON.stringify(cards)).not.toContain('Episode 3');
    });

    it('makes one card for repeated modules and ignores empty or mismatched official modules', () => {
        const noPath = { ...popularModule, request_extras: { path: '/recommend/special', params: { type: 1 } } };
        const wrongType = { ...weeklyModule, request_extras: { path: '/recommend/major', params: { type: 5 } } };
        const empty = homeModule('热门速递', 1, []);
        const broken = homeModule('热门速递', 1, [{ album_id: 0 }, { album_id: '../private' }]);
        expect(featuredPlaylists({ list: [popularModule, popularModule, weeklyModule] }).map(card => card.id))
            .toEqual(['featured:popular', 'featured:weekly']);
        expect(featuredPlaylists({ list: [empty, noPath, wrongType, broken] })).toEqual([]);
    });

    it('skips a malformed first child and uses the first real album cover', () => {
        const card = featuredPlaylists({ list: [homeModule('热门速递', 1, [{ album_id: 0 }, album])] })[0];
        expect(card).toMatchObject({ id: 'featured:popular', coverUrl: album.square });
    });

    it('rejects a home payload without a list', () => {
        expect(() => featuredPlaylists({})).toThrow('Invalid Fanjiao recommendations');
    });
});

describe('Fanjiao recommendation pages', () => {
    it('dedupes across pages, keeps first-seen album order and stops at the limit', async () => {
        const get = vi.fn()
            .mockResolvedValueOnce(homePage(1, 40, [{ modular_name: '合集', list: [album, { album_id: 8, name: 'First title' }] }]))
            .mockResolvedValueOnce(homePage(2, 40, [{ modular_name: '合集', list: [{ ...album, album_id: 9 }, { ...album, album_id: 8 }] }]));
        const items = await fetchRecommendedCollections({ get } as unknown as FanjiaoClient, 3);
        expect(items.map(item => item.id)).toEqual(['7', '8', '9']);
        expect(items[1]).toMatchObject({ name: 'First title', coverVariants: albumCovers });
        expect(get).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenNthCalledWith(1, '/walkman/api/recommend/home/limit',
            { page: 1, size: 20, is_teen: 0, tab_id: 1 });
        expect(get).toHaveBeenNthCalledWith(2, '/walkman/api/recommend/home/limit',
            { page: 2, size: 20, is_teen: 0, tab_id: 1 });
    });

    it('counts playlist cards against the combined limit and puts them before albums', async () => {
        const first = homePage(1, 40, [
            homeModule('热门速递', 1, [album]),
            homeModule('精品周更', 3, [{ ...album, album_id: 8 }]),
        ]);
        const second = homePage(2, 40, [{ modular_name: '更多', list: [album, { ...album, album_id: 9 }] }]);
        const get = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const items = await fetchRecommendedCollections({ get } as unknown as FanjiaoClient, 5);
        expect(items.map(item => item.id)).toEqual(['featured:popular', 'featured:weekly', '7', '8', '9']);
        expect(items.slice(0, 2).every(item => 'kind' in item && item.kind === 'playlist')).toBe(true);
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('returns only the cards when the limit is one or two', async () => {
        const get = vi.fn(async () => homePage(1, 20, [popularModule, weeklyModule]));
        const one = await fetchRecommendedCollections({ get } as unknown as FanjiaoClient, 1);
        expect(one.map(item => item.id)).toEqual(['featured:popular']);
        const two = await fetchRecommendedCollections({ get } as unknown as FanjiaoClient, 2);
        expect(two.map(item => item.id)).toEqual(['featured:popular', 'featured:weekly']);
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('keeps one request when the first page already satisfies the limit or ends the home feed', async () => {
        const filled = vi.fn(async () => homePage(1, 40, [{ list: [album, { ...album, album_id: 8 }] }]));
        expect((await fetchRecommendedCollections({ get: filled }, 2)).map(item => item.id)).toEqual(['7', '8']);
        expect(filled).toHaveBeenCalledTimes(1);
        const ended = vi.fn(async () => homePage(1, 1, [{ list: [album] }]));
        expect((await fetchRecommendedCollections({ get: ended }, 5)).map(item => item.id)).toEqual(['7']);
        expect(ended).toHaveBeenCalledTimes(1);
    });

    it('reads at most three bounded pages when modules carry no albums or cards', async () => {
        const get = vi.fn(async (path: string, params: Record<string, string | number>) => homePage(Number(params.page), 100, []));
        expect(await fetchRecommendedCollections({ get } as unknown as FanjiaoClient, 10)).toEqual([]);
        expect(get).toHaveBeenCalledTimes(3);
        expect(get.mock.calls.map(([, params]) => params.page)).toEqual([1, 2, 3]);
    });

    it('rejects broken pagination and bad limits before trusting the payload', async () => {
        await expect(fetchRecommendedCollections({ get: async () => ({ list: [], paging: { page: 2, page_size: 20, total: 1 } }) }, 5))
            .rejects.toThrow('pagination');
        await expect(fetchRecommendedCollections({ get: async () => ({ paging: { page: 1, page_size: 20, total: 1 } }) }, 5))
            .rejects.toThrow('Invalid Fanjiao recommendations');
        expect(recommendationLimit(undefined)).toBe(20);
        expect(recommendationLimit(1)).toBe(1);
        expect(recommendationLimit(50)).toBe(50);
        for (const value of [0, 51, 1.5, '3', Number.NaN]) {
            expect(() => recommendationLimit(value)).toThrow('limit');
        }
    });
});

describe('Fanjiao playlist albums', () => {
    const rows = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
        ...album, album_id: start + index, name: `Album ${start + index}`,
    }));
    const ids = (start: number, count: number) => rows(start, count).map(item => String(item.album_id));

    it('reads only the official pages intersecting the requested raw rows', async () => {
        const pageRows = new Map([[1, rows(100, 20)], [2, rows(120, 20)], [3, rows(140, 5)]]);
        const get = vi.fn(async (path: string, params: Record<string, string | number>) => {
            if (path !== '/walkman/api/recommend/major') throw new Error('unexpected path');
            return majorPage(Number(params.page), 45, pageRows.get(Number(params.page)) ?? []);
        });
        const last = await fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 20, 40);
        expect(last).toEqual({ items: expect.any(Array), hasMore: false, nextOffset: 45 });
        expect(last.items.map(item => item.id)).toEqual(ids(140, 5));
        expect(get.mock.calls.map(([, params]) => params.page)).toEqual([3]);

        get.mockClear();
        const middle = await fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 20, 20);
        expect(middle).toMatchObject({ hasMore: true, nextOffset: 40 });
        expect(middle.items.map(item => item.id)).toEqual(ids(120, 20));
        expect(get.mock.calls.map(([, params]) => params.page)).toEqual([2]);
    });

    it('slices an unaligned range to its overlap and dedupes only within the returned page', async () => {
        const get = vi.fn(async (_path: string, params: Record<string, string | number>) => {
            if (Number(params.page) === 2) return majorPage(2, 45, rows(120, 20));
            return majorPage(3, 45, [...rows(140, 4), { ...album, album_id: 139 }]);
        });
        const page = await fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 20, 25);
        expect(page).toMatchObject({ hasMore: false, nextOffset: 45 });
        expect(page.items.map(item => item.id)).toEqual(ids(125, 19));
        expect(get.mock.calls.map(([, params]) => params.page)).toEqual([2, 3]);
    });

    it('advances past short or empty upstream pages while there are later albums', async () => {
        const get: FanjiaoClient['get'] = async (_path, { page }) => (
            majorPage(Number(page), 45, page === 1 ? rows(100, 19) : page === 2 ? [] : rows(140, 5))
        );
        const first = await fetchPlaylistAlbums({ get }, 'featured:popular', 20, 0);
        expect(first.items.map(item => item.id)).toEqual(ids(100, 19));
        expect(first).toMatchObject({ hasMore: true, nextOffset: 20 });
        const second = await fetchPlaylistAlbums({ get }, 'featured:popular', 20, first.nextOffset);
        expect(second).toEqual({ items: [], hasMore: true, nextOffset: 40 });
        const third = await fetchPlaylistAlbums({ get }, 'featured:popular', 20, second.nextOffset);
        expect(third.items.map(item => item.id)).toEqual(ids(140, 5));
        expect(third).toMatchObject({ hasMore: false, nextOffset: 45 });
    });

    it('keeps raw offsets and hasMore after malformed and duplicate rows', async () => {
        const get = vi.fn(async () => majorPage(1, 21, [album, { album_id: 0 }, album, { ...album, album_id: 8 }]));
        const page = await fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 4, 0);
        expect(page).toEqual({ items: expect.any(Array), hasMore: true, nextOffset: 4 });
        expect(page.items.map(item => item.id)).toEqual(['7', '8']);
        expect(get).toHaveBeenCalledWith('/walkman/api/recommend/major', { page: 1, size: 20, type: 1 });
    });

    it('uses the weekly whitelist type and does not read episode or account endpoints', async () => {
        const get = vi.fn(async () => majorPage(1, 1, [album]));
        const page = await fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:weekly', 50, 0);
        expect(page.items.map(item => item.id)).toEqual(['7']);
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/walkman/api/recommend/major', { page: 1, size: 20, type: 3 });
    });

    it('rejects unknown playlist ids and bad paging before reaching the transport', async () => {
        const get = vi.fn();
        for (const id of ['featured:other', '7', '', null]) {
            await expect(fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, id, 20, 0))
                .rejects.toThrow('playlist');
        }
        await expect(fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 0, 0))
            .rejects.toThrow('limit');
        await expect(fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 101, 0))
            .rejects.toThrow('limit');
        await expect(fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 20, -1))
            .rejects.toThrow('offset');
        await expect(fetchPlaylistAlbums({ get } as unknown as FanjiaoClient, 'featured:popular', 20, 0.5))
            .rejects.toThrow('offset');
        expect(get).not.toHaveBeenCalled();
    });

    it('rejects broken pagination and a missing list', async () => {
        await expect(fetchPlaylistAlbums({
            get: async () => ({ list: [], paging: { page: 2, page_size: 20, total: 1 } }),
        } as unknown as FanjiaoClient, 'featured:popular', 20, 0)).rejects.toThrow('pagination');
        await expect(fetchPlaylistAlbums({
            get: async () => ({ paging: { page: 1, page_size: 20, total: 1 } }),
        } as unknown as FanjiaoClient, 'featured:popular', 20, 0)).rejects.toThrow('playlist');
    });
});

describe('Fanjiao signed transport', () => {
    it('signs sorted parameters with the local secret', () => {
        const expected = createHash('md5').update('a=1&b=2fixture-secret').digest('hex');
        expect(signFanjiaoGet({ b: 2, a: 1 }, 'fixture-secret')).toBe(expected);
    });

    it('keeps the verified app user agent and search device header', async () => {
        const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
        const fetchImpl: FanjiaoFetch = async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ code: 0, data: { ok: true } }));
        };
        const client = createFanjiaoClient('fixture-secret', fetchImpl);
        await client.get('/walkman/api/recommend/home/limit', { page: 1, size: 20, tab_id: 1, is_teen: 0 });
        await client.get('/walkman/api/recommend/major', { page: 1, size: 20, type: 3 });
        await client.get('/walkman/api/search/keyword', { keyword: 'winter', page: 1, size: 30, type: 2 });
        expect(new Headers(calls[0].init.headers as Record<string, string>).get('user-agent')).toBe('fanjiao/3.15.1 140 Android 15');
        expect(new Headers(calls[0].init.headers as Record<string, string>).get('sm_device')).toBeNull();
        expect(new Headers(calls[1].init.headers as Record<string, string>).get('user-agent')).toBe('fanjiao/3.15.1 140 Android 15');
        // The major read uses the fixed whitelist and its own numeric type.
        expect(new Headers(calls[1].init.headers as Record<string, string>).get('signature')).toBe(
            signFanjiaoGet({ page: 1, size: 20, type: 3 }, 'fixture-secret'));
        expect(new Headers(calls[2].init.headers as Record<string, string>).get('sm_device')).toBe('1');
        expect(new Headers(calls[2].init.headers as Record<string, string>).get('signature')).toBe(
            signFanjiaoGet({ keyword: 'winter', page: 1, size: 30, type: 2 }, 'fixture-secret'));
    });

    it('rejects arbitrary and retired paths, non-zero codes and a missing data object', async () => {
        const fetchImpl: FanjiaoFetch = async () => new Response(JSON.stringify({ code: 0, data: {} }));
        await expect(createFanjiaoClient('fixture-secret', fetchImpl).get('/arbitrary/path', {})).rejects.toThrow('Unsupported');
        for (const path of [
            '/walkman/api/ranking/album', '/walkman/api/recommend/special',
            '/walkman/api/search/classify/index', '/walkman/api/search/classify/filter',
        ]) {
            await expect(createFanjiaoClient('fixture-secret', fetchImpl).get(path, {})).rejects.toThrow('Unsupported');
        }
        const failing: FanjiaoFetch = async () => new Response(JSON.stringify({ code: 7, data: {} }));
        await expect(createFanjiaoClient('fixture-secret', failing).get('/walkman/api/album/album_info', {})).rejects.toThrow('code');
        const empty: FanjiaoFetch = async () => new Response(JSON.stringify({ code: 0 }));
        await expect(createFanjiaoClient('fixture-secret', empty).get('/walkman/api/album/album_info', {})).rejects.toThrow('no data');
        const refused: FanjiaoFetch = async () => new Response(null, { status: 403 });
        await expect(createFanjiaoClient('fixture-secret', refused).get('/walkman/api/album/album_info', {})).rejects.toThrow('HTTP 403');
    });
});
