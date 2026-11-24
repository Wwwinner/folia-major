import { describe, expect, it, vi } from 'vitest';
import type { FoliumSourceMainApi } from '@folia/folium';
import { parseFoliaLyricDocument } from '@/utils/lyrics/foliaLyricDocument';
import type { FanjiaoAlbum, FanjiaoRecommendation } from '../../../sources/fanjiao/contracts';
import type { FanjiaoClient } from '../../../sources/fanjiao/main/client';
import { readSigningSecret } from '../../../sources/fanjiao/main/credentials';
import activate from '../../../sources/fanjiao/main/index';
import { createFanjiaoService, type FanjiaoServiceOptions } from '../../../sources/fanjiao/main/service';
import type { FanjiaoMedia } from '../../../sources/fanjiao/main/vod';

// test/unit/fanjiao/mainService.test.ts
// RPC 边界、配置/授权/网络分类、本地媒体路由、字幕与关闭会话；全部离线。

const token = 'a'.repeat(48);
const mediaUrl = (rest: string) => `folia-mod://fanjiao/_media/stream/${rest}`;
const manifestBytes = Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:10,\n0.ts\n#EXTINF:10,\n1.ts\n#EXT-X-ENDLIST\n');
const media: FanjiaoMedia = { url: 'https://play.fanjiao.co/index.m3u8', key: null,
    metadata: { definition: 'FD', format: 'm3u8', duration: 20, size: 2, codec: 'aac', encrypted: false,
        encryption: null, available: [] } };
const albumRaw = { album_id: 7, name: 'Drama', square: 'https://example.com/square.png', play: 0 };
const homeModule = (name: string, type: number, list: unknown[]) => ({
    modular_name: name, type: 2, modular_style: 4,
    request_extras: { path: '/recommend/major', params: { type } }, list,
});
const episodeRaw = { audio_id: 11, album_id: 7, name: 'Episode', duration: 90 };
const playableRaw = { audio_id: '7', auth_timeout: 3000, play_auth: 'fixture-authorization', encrypt_src: 'fixture-video' };

function serviceWith(
    get: FanjiaoClient['get'],
    overrides: Partial<FanjiaoServiceOptions> = {},
    clock = { now: 0 },
) {
    return createFanjiaoService({
        client: { get }, mediaUrl, now: () => clock.now, randomToken: () => token,
        resolveMedia: async () => media,
        readAsset: async (url: string) => url.endsWith('.m3u8') ? manifestBytes : Buffer.from('segment'),
        ...overrides,
    });
}

describe('Fanjiao service status and failure classification', () => {
    it('reports an unconfigured source and keeps configuration distinct from network failure', async () => {
        const service = createFanjiaoService({ mediaUrl });
        try {
            expect(service.status()).toEqual({ configured: false });
            expect(await service.rpc('status', undefined)).toEqual({ ok: true, data: { configured: false } });
            expect(await service.rpc('album', { id: '7' })).toEqual({
                ok: false, code: 'not-configured', message: '饭角尚未配置签名凭据',
            });
        } finally { service.dispose(); }
        expect((await service.rpc('status', undefined)) as { ok: boolean }).toMatchObject({ ok: true, data: { configured: false } });
    });

    it('answers unknown operations, bad parameter shapes and bad pagination as invalid', async () => {
        const get = vi.fn(async () => ({}));
        const service = serviceWith(get);
        try {
            expect(await service.rpc('fetch', {})).toMatchObject({ ok: false, code: 'invalid' });
            expect(await service.rpc(1, {})).toMatchObject({ ok: false, code: 'invalid' });
            expect(await service.rpc('album', [])).toMatchObject({ ok: false, code: 'invalid' });
            expect(await service.rpc('recommendations', { limit: 0 })).toMatchObject({ ok: false, code: 'invalid' });
            expect(get).not.toHaveBeenCalled();
        } finally { service.dispose(); }
    });

    it('keeps a missing media authorization not-playable and a transport failure generic', async () => {
        const unauthorized = serviceWith(vi.fn(async () => ({ ...playableRaw, play_auth: '' })));
        try {
            expect(await unauthorized.rpc('audioSource', { id: '7' })).toEqual({
                ok: false, code: 'not-playable', message: '饭角未返回这集的播放授权，暂时无法播放',
            });
        } finally { unauthorized.dispose(); }
        const failing = serviceWith(vi.fn(async () => playableRaw), {
            resolveMedia: async () => { throw new TypeError('upstream media failed'); },
        });
        try {
            expect(await failing.rpc('audioSource', { id: '7' })).toEqual({
                ok: false, code: 'network', message: '饭角请求失败，请稍后重试',
            });
        } finally { failing.dispose(); }
    });
});

describe('Fanjiao catalog operations', () => {
    it('keeps album cache, episode order and search page semantics', async () => {
        let albumReads = 0;
        const get = vi.fn(async (path: string): Promise<Record<string, unknown>> => {
            if (path === '/walkman/api/album/album_info') { albumReads++; return albumRaw; }
            if (path === '/walkman/api/album/audio') {
                return { audios_list: [episodeRaw, { ...episodeRaw, audio_id: 12, is_positive: 1 }, { ...episodeRaw, audio_id: 13 }] };
            }
            if (path === '/walkman/api/audio/info') return { ...episodeRaw, album_id: 7 };
            if (path === '/walkman/api/search/keyword') {
                return { list: [albumRaw], paging: { page: 2, page_size: 2, total: 5 } };
            }
            throw new Error('unexpected path');
        });
        const service = serviceWith(get);
        try {
            const album = await service.request('album', { id: '7' }) as FanjiaoAlbum;
            expect(album).toMatchObject({ id: '7', coverUrl: 'https://example.com/square.png', playCount: 0 });
            const episodes = await service.request('episodes', { id: '7' }) as Array<Record<string, unknown>>;
            expect(episodes.map(episode => episode.id)).toEqual(['11', '12', '13']);
            expect(episodes[1]).toMatchObject({ isPositive: 1, albumName: 'Drama', coverUrl: 'https://example.com/square.png' });
            const episode = await service.request('episode', { id: '11' }) as Record<string, unknown>;
            expect(episode).toMatchObject({ id: '11', albumId: '7', albumName: 'Drama' });
            expect(albumReads).toBe(1);
            expect(await service.request('searchAlbums', { query: ' winter ', limit: 2, offset: 2 })).toMatchObject({
                total: 5, hasMore: true, nextOffset: 4, items: [{ id: '7' }],
            });
            expect(get).toHaveBeenCalledWith('/walkman/api/search/keyword',
                { keyword: 'winter', page: 2, size: 2, type: 2 }, undefined);
        } finally { service.dispose(); }
    });

    it('rejects an empty or oversized search before reaching the transport', async () => {
        const get = vi.fn(async () => ({ list: [], paging: { page: 1, page_size: 30, total: 0 } }));
        const service = serviceWith(get);
        try {
            await expect(service.request('searchAlbums', { query: '   ' })).rejects.toThrow('search');
            await expect(service.request('searchAlbums', { query: 'x'.repeat(201) })).rejects.toThrow('search');
            expect(get).not.toHaveBeenCalled();
        } finally { service.dispose(); }
    });
});

describe('Fanjiao recommendation operation', () => {
    it('puts the checked playlist cards first, then normalized albums in upstream order, deduped and limited', async () => {
        const get = vi.fn(async (path: string) => {
            if (path !== '/walkman/api/recommend/home/limit') throw new Error('unexpected path');
            return {
                paging: { page: 1, page_size: 20, total: 20 },
                list: [
                    homeModule('热门速递', 1, [albumRaw, { ...albumRaw, album_id: 8, name: 'Second' }]),
                    homeModule('热门速递', 1, [albumRaw, { ...albumRaw, album_id: 9, name: 'Third' }]),
                    homeModule('精品周更', 3, [{ ...albumRaw, album_id: 10, name: 'Weekly', square: 'https://example.com/weekly.png' }]),
                    { modular_name: 'Banner', type: 1, modular_style: 2, list: [
                        { type: 'album', title: 'Campaign', extras: { path: '/index/drama_info', params: { album_id: 11 } } },
                        { type: 'web', title: 'Ad', extras: { path: '/web', params: { album_id: 12 } } },
                    ] },
                ],
            };
        });
        const service = serviceWith(get);
        try {
            const items = await service.request('recommendations', { limit: 5 }) as FanjiaoRecommendation[];
            expect(items.map(item => item.id)).toEqual(['featured:popular', 'featured:weekly', '7', '8', '9']);
            expect(items[0]).toEqual({ kind: 'playlist', id: 'featured:popular', name: '热门速递',
                coverUrl: 'https://example.com/square.png', coverVariants: { square: 'https://example.com/square.png' },
                playlistContents: 'albums' });
            expect(items[1]).toMatchObject({ kind: 'playlist', id: 'featured:weekly', coverUrl: 'https://example.com/weekly.png' });
            expect(items[2]).toMatchObject({ name: 'Drama', coverUrl: 'https://example.com/square.png', playCount: 0 });
            expect(JSON.stringify(items.slice(0, 2))).not.toContain('trackCount');
            expect(JSON.stringify(items)).not.toContain('private-value');
            expect(get).toHaveBeenCalledWith('/walkman/api/recommend/home/limit',
                { page: 1, size: 20, is_teen: 0, tab_id: 1 }, undefined);
        } finally { service.dispose(); }
    });

    it('plays a checked playlist from the major list without reading episodes, albums or an account', async () => {
        const get = vi.fn(async (path: string, params: Record<string, string | number>) => {
            if (path !== '/walkman/api/recommend/major') throw new Error('unexpected path');
            expect(params).toEqual({ page: 1, size: 20, type: 1 });
            return {
                paging: { page: 1, page_size: 20, total: 2 },
                list: [albumRaw, { ...albumRaw, album_id: 8, name: 'Second' }, { ...albumRaw, album_id: 0 }],
            };
        });
        const service = serviceWith(get);
        try {
            const page = await service.request('playlistAlbums', {
                id: 'featured:popular', limit: 1, offset: 1,
            }) as { items: FanjiaoAlbum[]; hasMore: boolean; nextOffset: number };
            expect(page).toEqual({ items: expect.any(Array), hasMore: false, nextOffset: 2 });
            expect(page.items.map(item => item.id)).toEqual(['8']);
            expect(get).toHaveBeenCalledTimes(1);
            await expect(service.request('playlistAlbums', { id: 'featured:other', limit: 1, offset: 0 }))
                .rejects.toThrow('playlist');
            await expect(service.request('playlistAlbums', { id: '7', limit: 1, offset: 0 }))
                .rejects.toThrow('playlist');
            expect(get).toHaveBeenCalledTimes(1);
        } finally { service.dispose(); }
    });

    it('answers a recommendation request without a credential as not configured', async () => {
        const service = createFanjiaoService({ mediaUrl });
        try {
            expect(await service.rpc('recommendations', { limit: 5 })).toEqual({
                ok: false, code: 'not-configured', message: '饭角尚未配置签名凭据',
            });
        } finally { service.dispose(); }
    });
});

describe('Fanjiao subtitles', () => {
    it('gives the host a lossless folia track: raw newlines, overlaps, same-start cues and per-cue ends', async () => {
        const subtitle = Buffer.from(JSON.stringify({ content: [
            { content: 'B\nsecond line', newStart: '0:00:01', newEnd: '0:00:03' },
            { content: 'A', newStart: '0:00:00:45', newEnd: '0:00:02' },
            { content: 'C', newStart: '0:00:01', newEnd: '0:00:02' },
            { content: 'reversed', newStart: '0:00:05', newEnd: '0:00:04' },
            { content: '' },
        ] }));
        const get = vi.fn(async () => ({ audio_id: '7', subtitle: 'https://play.fanjiao.co/subtitles.json' }));
        const service = serviceWith(get, { readAsset: async () => subtitle, now: () => 0 });
        try {
            const lyrics = await service.request('lyrics', { id: '7' }) as { main: { format: string; text: string } };
            expect(lyrics.main.format).toBe('folia');
            const document = JSON.parse(lyrics.main.text) as { format: string; version: number; lyrics: { lines: Array<Record<string, unknown>>; isWordByWord: boolean } };
            expect(document).toMatchObject({ format: 'folia-lyricdata', version: 1, exportedAt: '1970-01-01T00:00:00.000Z' });
            expect(document.lyrics.isWordByWord).toBe(false);
            expect(document.lyrics.lines.map(line => [line.fullText, line.startTime, line.endTime])).toEqual([
                ['A', 0.045, 2], ['B\nsecond line', 1, 3], ['C', 1, 2],
            ]);
            expect(document.lyrics.lines.every(line => Array.isArray(line.words))).toBe(true);
            const host = parseFoliaLyricDocument(lyrics.main.text);
            expect(host?.lines.map(line => [line.fullText, line.startTime, line.endTime])).toEqual([
                ['A', 0.045, 2], ['B\nsecond line', 1, 3], ['C', 1, 2],
            ]);
        } finally { service.dispose(); }
    });

    it('returns null without a subtitle and keeps transport failures generic', async () => {
        const none = serviceWith(vi.fn(async () => playableRaw));
        try { expect(await none.request('lyrics', { id: '7' })).toBeNull(); } finally { none.dispose(); }
        const broken = serviceWith(vi.fn(async () => ({ audio_id: '7', subtitle: 'https://play.fanjiao.co/subs.json' })), {
            readAsset: async () => Buffer.from('{"content":[]}'),
        });
        try {
            expect(await broken.rpc('lyrics', { id: '7' })).toEqual({
                ok: false, code: 'network', message: '饭角请求失败，请稍后重试',
            });
        } finally { broken.dispose(); }
    });
});

describe('Fanjiao local HLS route and sessions', () => {
    it('serves only the generated manifest and relative segments, then closes the token', async () => {
        const get = vi.fn(async (path: string) => path === '/walkman/api/audio/info' ? playableRaw : {});
        const service = serviceWith(get);
        try {
            expect(await service.rpc('audioSource', { id: '7', quality: 'standard' })).toEqual({
                ok: true, data: { url: mediaUrl(`7/${token}/index.m3u8`), token },
            });
            const manifest = await service.handleMedia(`7/${token}/index.m3u8`);
            expect(manifest.status).toBe(200);
            expect(manifest.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
            expect(manifest.headers.get('access-control-allow-origin')).toBe('*');
            const text = await manifest.text();
            expect(text).toContain('segment/0.ts');
            expect(text).toContain('segment/1.ts');
            expect(text).not.toContain('EXT-X-KEY');
            const segment = await service.handleMedia(`7/${token}/segment/0.ts`);
            expect(segment.status).toBe(200);
            expect(Buffer.from(await segment.arrayBuffer())).toEqual(Buffer.from('segment'));
            expect((await service.handleMedia('7/../../etc/passwd')).status).toBe(404);
            expect((await service.handleMedia(`8/${token}/index.m3u8`)).status).toBe(410);
            expect((await service.handleMedia(`7/${'b'.repeat(48)}/index.m3u8`)).status).toBe(410);
            expect(await service.rpc('closeAudio', { token })).toEqual({ ok: true, data: null });
            expect((await service.handleMedia(`7/${token}/index.m3u8`)).status).toBe(410);
            expect(await service.request('closeAudio', { token: 'unknown' })).toBeNull();
        } finally { service.dispose(); }
    });

    it('reports a paused media token expired before the renderer tries to resume it', async () => {
        const clock = { now: 0 };
        const service = serviceWith(async () => playableRaw, {}, clock);
        try {
            await service.request('audioSource', { id: '7' });
            expect(await service.request('hasAudio', { token })).toBe(true);
            clock.now = 2 * 60 * 60 * 1000 + 1;
            expect(await service.request('hasAudio', { token })).toBe(false);
            expect((await service.handleMedia(`7/${token}/index.m3u8`)).status).toBe(410);
        } finally { service.dispose(); }
    });

    it('does not leave a session when closeAudio wins the async race', async () => {
        let started!: () => void;
        let answer!: (value: Record<string, unknown>) => void;
        const transportStarted = new Promise<void>(resolve => { started = resolve; });
        const get = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { answer = resolve; started(); }));
        const service = serviceWith(get, { randomToken: () => token });
        try {
            const pending = service.rpc('audioSource', { id: '7' });
            await transportStarted;
            expect(await service.rpc('closeAudio', { token })).toEqual({ ok: true, data: null });
            answer(playableRaw);
            expect(await pending).toEqual({ ok: false, code: 'network', message: '饭角请求失败，请稍后重试' });
            expect((await service.handleMedia(`7/${token}/index.m3u8`)).status).toBe(410);
        } finally { service.dispose(); }
    });

    it('releases every session on unload and stays safe for a late answer', async () => {
        let started!: () => void;
        let answer!: (value: Record<string, unknown>) => void;
        const transportStarted = new Promise<void>(resolve => { started = resolve; });
        const get = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { answer = resolve; started(); }));
        const service = serviceWith(get);
        const pending = service.rpc('audioSource', { id: '7' });
        await transportStarted;
        service.dispose();
        answer(playableRaw);
        expect(await pending).toMatchObject({ ok: false, code: 'network' });
        expect(service.status()).toEqual({ configured: false });
        expect((await service.handleMedia(`7/${token}/index.m3u8`)).status).toBe(410);
    });
});

describe('Fanjiao main entry', () => {
    it('registers the uniform rpc, the media route and unload cleanup', async () => {
        const rpc = new Map<string, (...args: unknown[]) => unknown>();
        const media = new Map<string, (request: { path: string }) => unknown>();
        let unload: (() => void) | undefined;
        const api = {
            net: { fetch: vi.fn(), request: vi.fn() },
            media: {
                url: (name: string, rest: string) => `folia-mod://fanjiao/_media/${name}/${rest}`,
                serve: (name: string, handler: (request: { path: string }) => unknown) => {
                    media.set(name, handler);
                    return () => { media.delete(name); };
                },
            },
            log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
            rpc: { handle: (name: string, handler: (...args: unknown[]) => unknown) => { rpc.set(name, handler); } },
            onBeforeUnload: (handler: () => void) => { unload = handler; return () => {}; },
            onDispose: (handler: () => void) => { unload = handler; },
        };
        activate(api as unknown as FoliumSourceMainApi);
        expect([...rpc.keys()]).toEqual(['fanjiao']);
        expect([...media.keys()]).toEqual(['stream']);
        const call = rpc.get('fanjiao') as (...args: unknown[]) => Promise<{ ok: boolean; data: { configured: boolean } }>;
        const status = await call('status', undefined);
        expect(status.ok).toBe(true);
        expect(typeof status.data.configured).toBe('boolean');
        expect(((await media.get('stream')!({ path: '../../etc/passwd' })) as Response).status).toBe(404);
        unload?.();
        expect((await call('status', undefined)).data.configured).toBe(false);
    });
});

describe('Fanjiao signing secret', () => {
    it('uses the environment secret first, then only an explicit file path', () => {
        const readFile = vi.fn(() => ' file-secret \n');
        expect(readSigningSecret({ FANJIAO_SIGNATURE_SECRET: ' direct-secret ', FANJIAO_SIGNATURE_SECRET_FILE: '/ignored' }, readFile)).toBe('direct-secret');
        expect(readFile).not.toHaveBeenCalled();
        expect(readSigningSecret({ FANJIAO_SIGNATURE_SECRET_FILE: '/explicit/secret' }, readFile)).toBe('file-secret');
        expect(readFile).toHaveBeenLastCalledWith('/explicit/secret');
        expect(readSigningSecret({}, readFile)).toBe('');
        expect(readFile).toHaveBeenCalledTimes(1);
        expect(readSigningSecret({ FANJIAO_SIGNATURE_SECRET_FILE: '/missing' }, () => { throw new Error('missing'); })).toBe('');
    });
});
