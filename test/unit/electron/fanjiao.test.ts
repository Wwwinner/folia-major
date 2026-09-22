import { describe, expect, it, vi } from 'vitest';
import { createPlaybackSession, parseManifest } from '../../../electron/fanjiao/session.mjs';
import { createFanjiaoService } from '../../../electron/fanjiao/service.mjs';
import { albumDto, episodeDto, hasEpisodeMediaAuthorization } from '../../../electron/fanjiao/catalog.mjs';
import { parseFanjiaoSubtitles } from '../../../electron/fanjiao/subtitles.mjs';
import { createRequire } from 'node:module';
import { createFanjiaoClient } from '../../../electron/fanjiao/client.mjs';

// 离线核验生产服务的权限、资源边界、并发刷新和内存缓存，不读取真实凭据。
const { isTrustedFanjiaoPage } = createRequire(import.meta.url)('../../../electron/fanjiao/bridge.cjs');
function fixture({ rejected = false, isPublic = 1, authorized = true, resolutionRejected = false } = {}) {
    let clock = 0;
    const calls = { api: 0, segments: 0 };
    const session = createPlaybackSession({ get: async () => {
        calls.api++;
        return { audio_id: 1, price: 0, is_public: isPublic, auth_timeout: 3000,
            play_auth: authorized ? 'fixture-authorization' : '', encrypt_src: 'fixture-video',
            access_info: { access_type: 3, is_time_limited: false, user_has_eligibility: false } };
    } }, '1', { now: () => clock, maxCacheBytes: 5,
        resolveMedia: async () => {
            if (resolutionRejected) throw Object.assign(new Error('VOD refused'), { status: 403 });
            return { url: 'https://play.fanjiao.co/index.m3u8', key: null, metadata: { definition: 'FD' } };
        },
        readAsset: async (url: string) => {
            if (url.endsWith('.m3u8')) return Buffer.from('#EXTM3U\n#EXTINF:10,\n0.ts\n#EXTINF:10,\n1.ts\n#EXT-X-ENDLIST\n');
            calls.segments++;
            if (rejected) throw Object.assign(new Error('rejected'), { status: 403 });
            return Buffer.from('1234');
        },
    } as any);
    return { session, calls, advance: () => { clock = 3000000; } };
}

describe('Fanjiao production session', () => {
    it('preserves section display metadata and rejects unsupported routes', async () => {
        const album = { album_id: 7, name: 'Drama', square: 'https://example.com/square.png', cover: 'https://example.com/poster.png',
            horizontal: 'https://example.com/landscape.png',
            play: 215870, new_audio_name: 'Episode 3', discount_name: 'Presale', play_auth: 'private-value' };
        const get = vi.fn(async (path: string) => path.endsWith('/home/limit')
            ? { paging: { page: 1, page_size: 10, total: 3 }, list: [
                { modular_name: '热门速递', request_extras: { path: '/recommend/major', params: { type: 1 } }, list: [album] },
                { modular_name: '精品周更', request_extras: { path: '/recommend/major', params: { type: 3 } }, list: [album] },
                { modular_name: '未知栏目', layout: 'landscape-grid', request_extras: { path: '/recommend/special', params: { type: 99 } }, list: [album] },
            ] }
            : { paging: { page: 2, page_size: 2, total: 5 }, list: [album] });
        const service = createFanjiaoService({ client: { get } } as any);
        try {
            const home = await service.request('homeSections', { limit: 10, offset: 0 });
            expect(home.items[0].moreId).toBe('popular');
            expect(home.items[1].moreId).toBe('weekly');
            expect(home.items[2].moreId).toBeUndefined();
            expect(home.items[0].layout).toBeUndefined();
            expect(home.items[1]).toMatchObject({ layout: 'landscape-grid', items: [{ landscapeCoverUrl: 'https://example.com/landscape.png' }] });
            expect(home.items[2].layout).toBeUndefined();
            const page = await service.request('sectionAlbums', { id: 'popular', limit: 2, offset: 2 });
            expect(get).toHaveBeenLastCalledWith('/walkman/api/recommend/major', { page: 2, size: 2, type: 1 });
            expect(page).toMatchObject({ total: 5, hasMore: true, nextOffset: 4, items: [{ id: '7', playCount: 215870,
                posterUrl: 'https://example.com/poster.png', landscapeCoverUrl: 'https://example.com/landscape.png', coverUrl: 'https://example.com/square.png', latestEpisodeName: 'Episode 3', promotionLabel: 'Presale' }] });
            expect(JSON.stringify(page)).not.toContain('private-value');
            await expect(service.request('sectionAlbums', { id: '/recommend/special' })).rejects.toThrow('Unsupported');
            await expect(service.request('sectionAlbums', { id: '__proto__' })).rejects.toThrow('Unsupported');
            expect(get).toHaveBeenCalledTimes(2);
        } finally { service.dispose(); }
    });
    it.each([
        ['popular', 'major', 1], ['weekly', 'major', 3], ['audiobooks', 'major', 5],
        ['discounts', 'special', 17], ['music', 'special', 12], ['new-releases', 'major', 4],
        ['romance', 'special', 5], ['historical', 'special', 3], ['angst', 'special', 7],
        ['sweet', 'special', 8], ['scenarios', 'special', 15], ['free', 'special', 16], ['one-shot', 'special', 9],
    ])('routes %s from its home metadata to the matching paged album endpoint', async (id, endpoint, type) => {
        const album = { album_id: 7, name: 'Drama' };
        const get = vi.fn(async (path: string) => path.endsWith('/home/limit')
            ? { paging: { page: 1, page_size: 20, total: 1 }, list: [
                { modular_name: 'Renamed section', request_extras: { path: `/recommend/${endpoint}`, params: { type } }, list: [album] },
                { modular_name: 'Podcast', request_extras: { path: '/recommend/special', params: { type: 13 } }, list: [album] },
            ] }
            : { paging: { page: 2, page_size: 2, total: 5 }, list: [album] });
        const service = createFanjiaoService({ client: { get } } as any);
        try {
            const home = await service.request('homeSections', { limit: 20, offset: 0 });
            expect(home.items[0].moreId).toBe(id);
            expect(home.items[1].moreId).toBeUndefined();
            const page = await service.request('sectionAlbums', { id, limit: 2, offset: 2 });
            expect(get).toHaveBeenLastCalledWith(`/walkman/api/recommend/${endpoint}`, { page: 2, size: 2, type });
            expect(page).toMatchObject({ total: 5, hasMore: true, nextOffset: 4, items: [{ id: '7' }] });
        } finally { service.dispose(); }
    });
    it('normalizes mixed discovery modules without leaking routes or credentials, and caches concurrent reads', async () => {
        const album = { album_id: 7, name: 'Drama', square: 'https://example.com/cover.png', play_auth: 'private-value' };
        const get = vi.fn(async () => ({ paging: { page: 1, page_size: 10, total: 23 }, list: [
            { modular_name: '广告', list: [{ banner_id: 1, type: 'web', link: 'https://example.com/private-value' }] },
            { modular_name: '推荐', list: [album] },
            { modular_name: '榜单', list: [{ name: '人气榜', rank_list: [album] }] },
            { modular_name: '空栏目', list: null },
        ] }));
        const service = createFanjiaoService({ client: { get } } as any);
        try {
            const [page, duplicate] = await Promise.all([service.request('homeSections', { limit: 10, offset: 0 }), service.request('homeSections', { limit: 10, offset: 0 })]);
            expect(get).toHaveBeenCalledTimes(1);
            expect(page).toEqual(duplicate);
            expect(page).toMatchObject({ total: 23, hasMore: true, nextOffset: 10, items: [
                { title: '推荐', kind: 'albums', items: [{ id: '7', name: 'Drama' }] },
                { title: '人气榜', kind: 'ranking', items: [{ id: '7', name: 'Drama' }] },
            ] });
            expect(JSON.stringify(page)).not.toContain('private-value');
        } finally { service.dispose(); }
    });
    it('maps browse filters and index aliases, rejects invalid pages and does not cache failures', async () => {
        const get = vi.fn().mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValue({
            result_data: [{ album_id: 9, title: 'Index title', cover_url: 'https://example.com/cover.png', play: 123 }],
            paging: { page: 2, page_size: 3, total: 6 },
        });
        const service = createFanjiaoService({ client: { get } } as any);
        const params = { limit: 3, offset: 3, category: '7', completion: '2', price: '2', sort: '2' };
        try {
            await expect(service.request('browseAlbums', params)).rejects.toThrow('temporary outage');
            const page = await service.request('browseAlbums', params);
            expect(get).toHaveBeenLastCalledWith('/walkman/api/search/classify/index', { page: 2, size: 3, category: 7, is_over: 2, is_buy: 2, sort: 2 });
            expect(page).toMatchObject({ hasMore: false, nextOffset: 6, items: [{ id: '9', name: 'Index title', coverUrl: 'https://example.com/cover.png', playCount: 123 }] });
            await expect(service.request('browseAlbums', { limit: 3, offset: 1 })).rejects.toThrow('page');
            await expect(service.request('browseAlbums', { category: 'not-an-id' })).rejects.toThrow('filter');
        } finally { service.dispose(); }
    });
    it('uses the verified homepage client header and keeps arbitrary paths outside the transport', async () => {
        const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ code: 0, data: {} })));
        vi.stubGlobal('fetch', fetchMock);
        try {
            const client = createFanjiaoClient('fixture-secret');
            await client.get('/walkman/api/recommend/home/limit', { page: 1, size: 20, tab_id: 1, is_teen: 0 });
            expect(new Headers(fetchMock.mock.calls[0][1].headers).get('user-agent')).toBe('fanjiao/3.15.1 140 Android 15');
            await client.get('/walkman/api/recommend/special', { page: 1, size: 20, type: 17 });
            expect(new Headers(fetchMock.mock.calls[1][1].headers).get('user-agent')).toBe('fanjiao/3.15.1 140 Android 15');
            await expect(client.get('/arbitrary/path', {})).rejects.toThrow('Unsupported');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally { vi.unstubAllGlobals(); }
    });
    it('preserves the provider main-episode marker without guessing from the name', () => {
        expect(episodeDto({ audio_id: 1, album_id: 2, is_positive: 1, name: '小剧场' }).isPositive).toBe(1);
        expect(episodeDto({ audio_id: 1, album_id: 2, is_positive: 2 }).isPositive).toBe(2);
        expect(episodeDto({ audio_id: 1, album_id: 2, name: '第一集' }).isPositive).toBeNull();
    });
    it('restricts IPC pages to the app entry origin', () => {
        expect(isTrustedFanjiaoPage('http://localhost:3000/?view=home', '/app', true)).toBe(true);
        expect(isTrustedFanjiaoPage('https://evil.invalid/', '/app', true)).toBe(false);
        expect(isTrustedFanjiaoPage('http://localhost:3001/', '/app', true)).toBe(false);
        expect(isTrustedFanjiaoPage('http://localhost:3000/', '/app', false)).toBe(false);
    });
    it('preserves a real zero play count and leaves missing or invalid counts unknown', () => {
        for (const play of [0, 28177]) {
            expect(episodeDto({ audio_id: 1, album_id: 2, play }).playCount).toBe(play);
        }
        for (const play of [undefined, null, '', -1, 1.5, NaN, Infinity]) {
            expect(episodeDto({ audio_id: 1, album_id: 2, play }).playCount).toBeUndefined();
        }
    });
    it('shares preparation and refresh, and de-duplicates concurrent segment reads', async () => {
        const { session, calls, advance } = fixture();
        await Promise.all([session.source(), session.playlist(), session.segment(0), session.segment(0)]);
        expect(calls).toEqual({ api: 1, segments: 1 });
        advance();
        await Promise.all([session.source(), session.playlist()]);
        expect(calls.api).toBe(2);
        session.dispose();
    });
    it('evicts segment bytes beyond the configured budget', async () => {
        const { session, calls } = fixture();
        await session.segment(0);
        await session.segment(0);
        await session.segment(1);
        await session.segment(0);
        expect(calls.segments).toBe(3);
        session.dispose();
    });
    it('stops after one refresh on persistent upstream refusal', async () => {
        const { session, calls } = fixture({ rejected: true });
        await expect(session.segment(0)).rejects.toThrow('rejected');
        expect(calls).toEqual({ api: 2, segments: 2 });
        session.dispose();
    });
    it('reports missing authorization and refuses disposed sessions', async () => {
        const { session } = fixture({ authorized: false });
        await expect(session.source()).rejects.toMatchObject({ code: 'not-playable' });
        session.dispose();
        await expect(session.source()).rejects.toThrow('disposed');
    });
    it('requires media authorization instead of inferring access from catalog flags', () => {
        expect(hasEpisodeMediaAuthorization({ play_auth: 'present', encrypt_src: 'video', is_public: 0 })).toBe(true);
        expect(hasEpisodeMediaAuthorization({ price: 0, is_public: 1 })).toBe(false);
        expect(hasEpisodeMediaAuthorization({ play_auth: 'present' })).toBe(false);
        expect(hasEpisodeMediaAuthorization({ play_auth: ' ', encrypt_src: 'video' })).toBe(false);
    });
    it('plays the episode-two metadata combination when upstream media requests succeed', async () => {
        const { session, calls } = fixture({ isPublic: 0 });
        await expect(session.source()).resolves.toMatchObject({ quality: 'standard' });
        await expect(session.segment(0)).resolves.toEqual(Buffer.from('1234'));
        expect(calls).toEqual({ api: 1, segments: 1 });
        session.dispose();
    });
    it('preserves an upstream refusal even when media authorization is present', async () => {
        const { session, calls } = fixture({ isPublic: 0, resolutionRejected: true });
        await expect(session.source()).rejects.toThrow('VOD refused');
        expect(calls).toEqual({ api: 1, segments: 0 });
        session.dispose();
    });
    it('rewrites relative segments and rejects foreign media hosts', () => {
        const raw = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n';
        expect(parseManifest(Buffer.from(raw), 'https://play.fanjiao.co/index.m3u8').local).not.toContain('KEY');
        expect(parseManifest(Buffer.from(raw), 'https://play.fanjiao.co/index.m3u8').local).toContain('segment/0.ts');
        expect(() => parseManifest(Buffer.from(raw.replace('0.ts', 'https://evil.invalid/0.ts')), 'https://play.fanjiao.co/index.m3u8')).toThrow('host');
    });
    it('keeps credentials out of metadata and denies arbitrary IPC operations', async () => {
        const raw = { album_id: 1, name: 'Album', play_auth: 'secret', src: 'secret', token: 'secret' };
        expect(JSON.stringify(albumDto(raw))).not.toContain('secret');
        const service = createFanjiaoService({ client: { get: async () => raw } } as any);
        await expect(service.request('fetch', { url: 'https://evil.invalid' })).rejects.toThrow('Unsupported');
        expect((await service.handleProtocol(new Request('folia-hls://fanjiao/etc/passwd'))).status).toBe(404);
        service.dispose();
    });
    it('preserves overlapping subtitles and literal millisecond values', () => {
        const { lyrics } = parseFanjiaoSubtitles({ content: [
            { content: 'B', newStart: '0:00:01', newEnd: '0:00:03' },
            { content: 'A', newStart: '0:00:00:45', newEnd: '0:00:02' },
        ] }, 1);
        expect(lyrics.lines.map((line: any) => [line.fullText, line.startTime, line.endTime])).toEqual([['A', .045, 2], ['B', 1, 3]]);
    });
});
