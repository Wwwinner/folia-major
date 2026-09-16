import { describe, expect, it } from 'vitest';
import { createPlaybackSession, parseManifest } from '../../../electron/fanjiao/session.mjs';
import { createFanjiaoService } from '../../../electron/fanjiao/service.mjs';
import { albumDto, episodeDto, hasEpisodeMediaAuthorization } from '../../../electron/fanjiao/catalog.mjs';
import { parseFanjiaoSubtitles } from '../../../electron/fanjiao/subtitles.mjs';
import { createRequire } from 'node:module';

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
