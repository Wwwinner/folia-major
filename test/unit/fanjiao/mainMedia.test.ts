import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackSession, parseManifest, readMediaAsset, trustedMediaUrl } from '../../../sources/fanjiao/main/session';
import { fetchChromiumMedia, type FanjiaoChromiumNet } from '../../../sources/fanjiao/main/chromiumMediaFetch';
import { parseFanjiaoSubtitles, parseSubtitleTime } from '../../../sources/fanjiao/main/subtitles';
import type { FanjiaoFetch, FanjiaoFetchInit } from '../../../sources/fanjiao/main/client';
import { resolveVod, type FanjiaoMedia } from '../../../sources/fanjiao/main/vod';

// test/unit/fanjiao/mainMedia.test.ts
// 分片会话、清单边界、Chromium 字节流和句级字幕的离线合同。

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const manifest = Buffer.from('#EXTM3U\n#EXTINF:10,\n0.ts\n#EXTINF:10,\n1.ts\n#EXT-X-ENDLIST\n');
const media: FanjiaoMedia = { url: 'https://play.fanjiao.co/index.m3u8', key: null,
    metadata: { definition: 'FD', format: 'm3u8', duration: 20, size: 2, codec: 'aac', encrypted: false,
        encryption: null, available: [] } };

describe('Fanjiao media manifest and host boundary', () => {
    it('rewrites relative segments, strips key lines and rejects foreign or unsupported playlists', () => {
        const raw = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n';
        const parsed = parseManifest(Buffer.from(raw), 'https://play.fanjiao.co/index.m3u8');
        expect(parsed.local).not.toContain('EXT-X-KEY');
        const privateTag = '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="https://play.fanjiao.co/key"';
        const withPrivateFields = raw.replace('#EXTINF:10,', `${privateTag}\n#EXTINF:10,https://play.fanjiao.co/private.ts`);
        expect(parseManifest(Buffer.from(withPrivateFields), 'https://play.fanjiao.co/index.m3u8').local).not.toContain('https://');
        expect(parsed.local).toContain('segment/0.ts');
        expect(parsed.segments).toEqual(['https://play.fanjiao.co/0.ts']);
        expect(() => parseManifest(Buffer.from(raw.replace('0.ts', 'https://evil.invalid/0.ts')), 'https://play.fanjiao.co/index.m3u8')).toThrow('host');
        expect(() => parseManifest(Buffer.from('#EXTM3U\n#EXT-X-MAP:URI="x"\n#EXT-X-ENDLIST\n'), 'https://play.fanjiao.co/i.m3u8')).toThrow('playlist');
        expect(() => parseManifest(Buffer.from('#EXTM3U\n0.ts\n'), 'https://play.fanjiao.co/i.m3u8')).toThrow('playlist');
        expect(() => parseManifest(Buffer.from('#EXTM3U\n#EXT-X-ENDLIST\n'), 'https://play.fanjiao.co/i.m3u8')).toThrow('segment count');
    });

    it.each([
        'http://play.fanjiao.co/a.ts', 'https://user:password@play.fanjiao.co/a.ts',
        'https://play.fanjiao.co:8443/a.ts', 'https://evil.invalid/a.ts', 'https://fanjiao.co.evil.invalid/a.ts',
    ])('rejects a media host outside the trusted roots: %s', url => {
        expect(() => trustedMediaUrl(url)).toThrow('host');
    });

    it('accepts the platform and CDN roots', () => {
        for (const url of ['https://play.fanjiao.co/a.ts', 'https://fanjiao.cn/a.ts', 'https://cdn.rela.me/a.ts', 'https://bucket.aliyuncs.com/a.ts']) {
            expect(trustedMediaUrl(url).href).toBe(url);
        }
    });
});

describe('Fanjiao media download', () => {
    it('allows 60 seconds for fragments and 20 for manifests and other assets', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        const fetchMedia: FanjiaoFetch = async () => new Response('complete');
        await readMediaAsset('https://play.fanjiao.co/a.ts', undefined, 100, fetchMedia);
        expect(timeout).toHaveBeenLastCalledWith(60000);
        await readMediaAsset('https://play.fanjiao.co/index.m3u8', undefined, 100, fetchMedia);
        expect(timeout).toHaveBeenLastCalledWith(20000);
    });

    it('recovers temporary HTTP and network failures within one shared deadline', async () => {
        vi.useFakeTimers();
        const fetchMedia = vi.fn(async () => new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(new Response('complete'));
        const pending = readMediaAsset('https://play.fanjiao.co/a.ts', undefined, 100, fetchMedia);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await pending).toEqual(Buffer.from('complete'));
        expect(fetchMedia).toHaveBeenCalledTimes(3);
        const calls = fetchMedia.mock.calls as unknown as Array<[string, FanjiaoFetchInit]>;
        expect(calls[0][1].signal).toBe(calls[2][1].signal);
    });

    it('does not retry a refusal and cancels an oversized body', async () => {
        const refused = vi.fn(async () => new Response(null, { status: 403 }));
        await expect(readMediaAsset('https://play.fanjiao.co/a.ts', undefined, 100, refused)).rejects.toMatchObject({ status: 403 });
        expect(refused).toHaveBeenCalledOnce();
        const large = vi.fn(async () => new Response('too large'));
        await expect(readMediaAsset('https://play.fanjiao.co/a.ts', undefined, 2, large)).rejects.toThrow('size limit');
        expect(large).toHaveBeenCalledOnce();
    });

    it('aborts backoff with the session signal', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const fetchMedia = vi.fn(async () => new Response(null, { status: 503 }));
        const result = expect(readMediaAsset('https://play.fanjiao.co/a.ts', controller.signal, 100, fetchMedia))
            .rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(1);
        controller.abort();
        await result;
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMedia).toHaveBeenCalledOnce();
    });
});

function sessionFixture({ rejected = false, authorized = true, resolutionRejected = false } = {}) {
    let clock = 0;
    const calls = { api: 0, segments: 0 };
    const get = vi.fn(async (): Promise<Record<string, unknown>> => {
        calls.api++;
        return { audio_id: 1, auth_timeout: 3000, play_auth: authorized ? 'fixture-authorization' : '',
            encrypt_src: 'fixture-video' };
    });
    const session = createPlaybackSession({ get }, '1', {
        now: () => clock, maxCacheBytes: 5,
        resolveMedia: async () => {
            if (resolutionRejected) throw Object.assign(new Error('VOD refused'), { status: 403 });
            return media;
        },
        readAsset: async (url: string) => {
            if (url.endsWith('.m3u8')) return manifest;
            calls.segments++;
            if (rejected) throw Object.assign(new Error('rejected'), { status: 403 });
            return Buffer.from('1234');
        },
    });
    return { session, calls, advance: () => { clock = 3000000; } };
}

describe('Fanjiao playback session', () => {
    it('shares preparation and refresh, and de-duplicates concurrent segment reads', async () => {
        const { session, calls, advance } = sessionFixture();
        await Promise.all([session.source(), session.playlist(), session.segment(0), session.segment(0)]);
        expect(calls).toEqual({ api: 1, segments: 1 });
        advance();
        await Promise.all([session.source(), session.playlist()]);
        expect(calls.api).toBe(2);
        session.dispose();
    });

    it('evicts segment bytes beyond the configured budget', async () => {
        const { session, calls } = sessionFixture();
        await session.segment(0);
        await session.segment(0);
        await session.segment(1);
        await session.segment(0);
        expect(calls.segments).toBe(3);
        session.dispose();
    });

    it('refreshes once on a 403 and stops after one retry when the refusal persists', async () => {
        const revived = sessionFixture({ rejected: true });
        await expect(revived.session.segment(0)).rejects.toThrow('rejected');
        expect(revived.calls).toEqual({ api: 2, segments: 2 });
        revived.session.dispose();
        const refused = sessionFixture({ resolutionRejected: true });
        await expect(refused.session.source()).rejects.toThrow('VOD refused');
        expect(refused.calls).toEqual({ api: 1, segments: 0 });
        refused.session.dispose();
    });

    it('reports missing authorization and refuses work after disposal', async () => {
        const { session, calls } = sessionFixture({ authorized: false });
        await expect(session.source()).rejects.toMatchObject({ code: 'not-playable' });
        expect(calls).toEqual({ api: 1, segments: 0 });
        session.dispose();
        await expect(session.source()).rejects.toThrow('disposed');
        await expect(session.segment(0)).rejects.toThrow('disposed');
    });

    it('serves the local playlist with relative paths and validates the segment index', async () => {
        const { session } = sessionFixture();
        expect(await session.playlist()).toBe(parseManifest(manifest, media.url).local);
        await expect(session.segment(-1)).rejects.toThrow('index');
        await expect(session.segment(2)).rejects.toThrow('index');
        session.dispose();
    });
});

function chromiumFixture(status = 200) {
    const response = Object.assign(new EventEmitter(), { statusCode: status,
        headers: { 'content-disposition': 'attachment; filename="白月光字幕.json"' } });
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn(), setHeader: vi.fn(), write: vi.fn() });
    const net = { request: vi.fn(() => request) };
    return { response, request, net: net as unknown as FanjiaoChromiumNet };
}

describe('Chromium media stream adapter', () => {
    it('accepts non-Latin response headers and streams exact bytes', async () => {
        const { net, request, response } = chromiumFixture();
        const pending = fetchChromiumMedia(net, new URL('https://play.fanjiao.co/a.ts'));
        request.emit('close');
        request.emit('response', response);
        const result = await pending;
        const body = result.arrayBuffer();
        response.emit('data', Buffer.from([1, 2]));
        request.emit('close');
        response.emit('data', Buffer.from([3]));
        response.emit('end');
        expect([...new Uint8Array(await body)]).toEqual([1, 2, 3]);
        expect(result.status).toBe(200);
    });

    it('propagates an abort before headers and during the response', async () => {
        for (const received of [false, true]) {
            const { net, request, response } = chromiumFixture();
            const controller = new AbortController();
            const pending = fetchChromiumMedia(net, 'https://play.fanjiao.co/a.ts', { signal: controller.signal });
            if (received) request.emit('response', response);
            const result = received ? (await pending).arrayBuffer() : pending;
            const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
            controller.abort();
            request.emit('abort');
            await rejection;
            expect(request.abort).toHaveBeenCalledOnce();
        }
    });

    it('rejects failed and truncated transfers instead of accepting partial audio', async () => {
        for (const received of [false, true]) {
            const { net, request, response } = chromiumFixture();
            const pending = fetchChromiumMedia(net, 'https://play.fanjiao.co/a.ts');
            if (received) request.emit('response', response);
            const result = received ? (await pending).arrayBuffer() : pending;
            const rejection = expect(result).rejects.toBeInstanceOf(TypeError);
            if (received) { response.emit('data', Buffer.from('partial')); response.emit('aborted'); }
            else request.emit('error', new Error('net::ERR_FAILED'));
            request.emit('close');
            await rejection;
        }
    });

    it('keeps an HTTP refusal status and cancels the request when the body is cancelled', async () => {
        const { net, request, response } = chromiumFixture(403);
        const pending = fetchChromiumMedia(net, 'https://play.fanjiao.co/a.ts');
        request.emit('response', response);
        const result = await pending;
        expect(result.status).toBe(403);
        expect(result.ok).toBe(false);
        await result.body!.cancel();
        expect(request.abort).toHaveBeenCalledOnce();
    });
});

describe('Fanjiao subtitle times', () => {
    it('reads hours:minutes:seconds:millis literally and rejects impossible clocks', () => {
        expect(parseSubtitleTime('0:00:01')).toBe(1);
        expect(parseSubtitleTime('1:02:03')).toBe(3723);
        expect(parseSubtitleTime('0:00:00:45')).toBe(0.045);
        for (const value of ['0:60:00', '0:00:60', '1:2', 'x', '', null]) {
            expect(() => parseSubtitleTime(value)).toThrow('subtitle');
        }
    });

    it('keeps every valid overlapping cue and counts the malformed ones', () => {
        const parsed = parseFanjiaoSubtitles({ content: [
            { content: 'B', newStart: '0:00:01', newEnd: '0:00:03' },
            { content: 'A', startTime: '0:00:00', endTime: '0:00:02' },
            { content: 'reversed', newStart: '0:00:05', newEnd: '0:00:04' },
            { content: '   ' },
            { content: 'C', newStart: '0:00:01', newEnd: '0:00:02' },
        ] }, '7');
        expect(parsed.invalidCount).toBe(1);
        expect(parsed.lyrics.lines.map(line => [line.id, line.fullText, line.startTime, line.endTime])).toEqual([
            ['fanjiao:7:1', 'A', 0, 2], ['fanjiao:7:0', 'B', 1, 3], ['fanjiao:7:4', 'C', 1, 2],
        ]);
        expect(() => parseFanjiaoSubtitles({ content: [] }, '7')).toThrow('No valid subtitle cues');
        expect(() => parseFanjiaoSubtitles({}, '7')).toThrow('cue list');
    });
});

describe('Fanjiao VOD media resolution', () => {
    const auth = Buffer.from(JSON.stringify({ AccessKeyId: 'fixture-id', AccessKeySecret: 'fixture-secret',
        SecurityToken: 'fixture-token', AuthInfo: 'fixture-info', Region: 'cn-shanghai' })).toString('base64');
    const payload = { play_auth: auth, encrypt_src: 'fixture-video' };
    const track = { Format: 'm3u8', Definition: 'FD', PlayURL: 'https://play.fanjiao.co/index.m3u8', Encrypt: 0,
        CodecName: 'aac', Size: 12, Duration: 20 };

    it('selects the requested HLS quality and falls back to FD, keeping only public metadata', async () => {
        const fetchMedia = vi.fn(async () => new Response(JSON.stringify({
            PlayInfoList: { PlayInfo: [{ ...track, Definition: 'LD' }, track] },
        })));
        const resolved = await resolveVod(payload, 'HQ', undefined, fetchMedia);
        expect(resolved).toMatchObject({ url: track.PlayURL, key: null,
            metadata: { definition: 'FD', format: 'm3u8', duration: 20, encrypted: false, encryption: null,
                available: [{ definition: 'LD', format: 'm3u8' }, { definition: 'FD', format: 'm3u8' }] } });
        expect(JSON.stringify(resolved)).not.toContain('fixture-secret');
        const calls = fetchMedia.mock.calls as unknown as Array<[string, FanjiaoFetchInit]>;
        expect(calls[0][1].headers?.['user-agent'] ?? '').toContain('AliPlayer');
    });

    it('refuses incomplete authorization and an unavailable quality', async () => {
        const emptyAuth = Buffer.from('{}').toString('base64');
        await expect(resolveVod({ play_auth: emptyAuth, encrypt_src: 'v' })).rejects.toThrow('Incomplete');
        const onlyMp4 = vi.fn(async () => new Response(JSON.stringify({ PlayInfoList: { PlayInfo: [{ ...track, Format: 'mp4' }] } })));
        await expect(resolveVod(payload, 'HQ', undefined, onlyMp4)).rejects.toThrow('quality');
    });

    it('keeps an upstream refusal status and a safe error code', async () => {
        const refused = vi.fn(async () => new Response(JSON.stringify({ Code: 'InvalidAccessKeyId.NotFound' }), { status: 403 }));
        await expect(resolveVod(payload, 'HQ', undefined, refused)).rejects.toThrow('VOD HTTP 403 (InvalidAccessKeyId.NotFound)');
    });
});
