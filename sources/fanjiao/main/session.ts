import type { FoliumSourceLyricsResult } from '@folia/folium';
import { setTimeout as delay } from 'node:timers/promises';
import type { FanjiaoClient, FanjiaoFetch } from './client';
import { hasEpisodeMediaAuthorization, requireId } from './catalog';
import type { FanjiaoRecord } from './normalize';
import { createFanjiaoLyrics, parseFanjiaoSubtitles } from './subtitles';
import { decryptTransportStream } from './transportStream';
import { resolveVod, type FanjiaoMedia, type FanjiaoResolveMedia } from './vod';

// sources/fanjiao/main/session.ts
// 按需处理 HLS 分片；会话内共享刷新与下载，有限缓存，销毁时取消未完成的请求。
const trustedRoots = ['fanjiao.co', 'fanjiao.cn', 'rela.me', 'aliyuncs.com'];

export function trustedMediaUrl(value: string | URL): URL {
    const url = value instanceof URL ? value : new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !trustedRoots.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`))) {
        throw new Error('Unrecognized Fanjiao media host');
    }
    return url;
}

const defaultFetch: FanjiaoFetch = (url, init) => fetch(url, init);

const statusOf = (error: unknown): number | undefined => (
    error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined
);

export async function readMediaAsset(
    value: string,
    signal?: AbortSignal,
    maxBytes = 16 * 1024 * 1024,
    fetchMedia: FanjiaoFetch = defaultFetch,
): Promise<Buffer<ArrayBuffer>> {
    const url = trustedMediaUrl(value);
    // 高音质分片约为标准音质的四倍；完整下载预算与 renderer 的 65 秒等待配套。
    const timeout = AbortSignal.timeout(url.pathname.endsWith('.ts') ? 60000 : 20000);
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    for (let attempt = 0; ; attempt++) {
        try { return await readMediaAttempt(url, deadline, maxBytes, fetchMedia); }
        catch (error: unknown) {
            const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                ? error.code : '';
            const transient = error instanceof TypeError || [408, 429, 500, 502, 503, 504].includes(statusOf(error) ?? 0)
                || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
            if (deadline.aborted || attempt >= 2 || !transient) throw error;
            // 所有重试共用原始截止时间，不把一次下载等待重复放大。
            await delay(250 * (attempt + 1), undefined, { signal: deadline });
        }
    }
}

async function readMediaAttempt(url: URL, signal: AbortSignal, maxBytes: number, fetchMedia: FanjiaoFetch): Promise<Buffer<ArrayBuffer>> {
    const response = await fetchMedia(url.href, { redirect: 'error', signal });
    if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`Media HTTP ${response.status}`), { status: response.status });
    }
    if (!response.body) throw new TypeError('Media response has no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) {
                await reader.cancel();
                throw new Error('Fanjiao asset exceeds size limit');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
}

export function parseManifest(bytes: Buffer, baseUrl: string): { local: string; segments: string[] } {
    const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== '#EXTM3U' || !lines.includes('#EXT-X-ENDLIST')
        || lines.some(line => /^#EXT-X-(?:MAP|STREAM-INF|BYTERANGE):/.test(line))) {
        throw new Error('Unsupported Fanjiao media playlist');
    }
    const segments = lines.filter(line => line && !line.startsWith('#'))
        .map(line => trustedMediaUrl(new URL(line, baseUrl)).href);
    if (!segments.length || segments.length > 10000) throw new Error('Invalid Fanjiao segment count');
    const safeTag = /^#(?:EXTM3U|EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|PLAYLIST-TYPE|ENDLIST|DISCONTINUITY(?:-SEQUENCE)?|INDEPENDENT-SEGMENTS|GAP))(?::[\d\w-]+)?$/;
    let index = 0;
    const local = lines.flatMap(line => {
        if (!line) return [];
        if (!line.startsWith('#')) return [`segment/${index++}.ts`];
        if (safeTag.test(line)) return [line];
        const duration = /^#EXTINF:(\d+(?:\.\d+)?)(?:,|$)/.exec(line);
        return duration ? [`#EXTINF:${duration[1]},`] : [];
    }).join('\n') + '\n';
    return { local, segments };
}

export interface FanjiaoPlaybackSession {
    source(): Promise<{ fetchedAt: number; expiresAt: number; quality: 'standard' | 'high' }>;
    playlist(): Promise<string>;
    segment(index: number, mayRefresh?: boolean): Promise<Buffer<ArrayBuffer>>;
    dispose(): void;
}

export interface FanjiaoPlaybackSessionOptions {
    definition?: string;
    now?: () => number;
    resolveMedia?: FanjiaoResolveMedia;
    readAsset?: (url: string, signal?: AbortSignal, maxBytes?: number) => Promise<Buffer<ArrayBuffer>>;
    maxCacheBytes?: number;
}

interface Current {
    media: FanjiaoMedia;
    manifest: { local: string; segments: string[] };
    cache: Map<number, Buffer<ArrayBuffer>>;
    downloads: Map<number, Promise<Buffer<ArrayBuffer>>>;
    bytes: number;
    expiresAt: number;
}

export function createPlaybackSession(
    client: Pick<FanjiaoClient, 'get'>,
    audioId: string,
    {
        definition = 'FD', now = Date.now, resolveMedia = resolveVod,
        readAsset = readMediaAsset, maxCacheBytes = 8 * 1024 * 1024,
    }: FanjiaoPlaybackSessionOptions = {},
): FanjiaoPlaybackSession {
    requireId(audioId);
    const controller = new AbortController();
    let current: Current | null = null;
    let pending: Promise<Current> | null = null;
    let disposed = false;
    const assertAlive = () => { if (disposed) throw new Error('Fanjiao session disposed'); };
    // 新旧请求竞争时只安装一个新授权；每次失败最多刷新一次。
    async function prepare(): Promise<Current> {
        assertAlive();
        if (pending) return pending;
        pending = (async () => {
            const payload = await client.get('/walkman/api/audio/info', { audio_id: audioId }, controller.signal, { fresh: true });
            const payloadId = payload.audio_id;
            const idMatches = (typeof payloadId === 'string' || typeof payloadId === 'number') && String(payloadId) === audioId;
            if (!idMatches) throw new Error('Unexpected Fanjiao episode');
            if (!hasEpisodeMediaAuthorization(payload)) {
                throw Object.assign(new Error('饭角未返回这集的播放授权，暂时无法播放'), { code: 'not-playable' });
            }
            const media = await resolveMedia(payload, definition, controller.signal);
            const manifest = parseManifest(await readAsset(media.url, controller.signal, 2 * 1024 * 1024), media.url);
            assertAlive();
            const ttl = Number(payload.auth_timeout);
            current = { media, manifest, cache: new Map(), downloads: new Map(), bytes: 0,
                expiresAt: now() + Math.max(30, (Number.isFinite(ttl) && ttl > 0 ? ttl : 3000) - 60) * 1000 };
            return current;
        })().finally(() => { pending = null; });
        return pending;
    }
    const ensure = (): Promise<Current> => {
        assertAlive();
        const active = current;
        return !active || active.expiresAt <= now() ? prepare() : Promise.resolve(active);
    };

    async function segment(index: number, mayRefresh = true): Promise<Buffer<ArrayBuffer>> {
        const session = await ensure();
        if (!Number.isSafeInteger(index) || index < 0 || index >= session.manifest.segments.length) throw new Error('Invalid segment index');
        if (session.cache.has(index)) {
            const cached = session.cache.get(index);
            if (cached) {
                session.cache.delete(index);
                session.cache.set(index, cached);
                return cached;
            }
        }
        const download = session.downloads.get(index);
        if (download) return download;
        const task = (async () => {
            try {
                const bytes = await readAsset(session.manifest.segments[index], controller.signal);
                assertAlive();
                const clear = session.media.key ? decryptTransportStream(bytes, session.media.key) : bytes;
                if (clear.length <= maxCacheBytes) {
                    while (session.bytes + clear.length > maxCacheBytes && session.cache.size) {
                        const key = session.cache.keys().next().value;
                        if (key === undefined) break;
                        const evicted = session.cache.get(key);
                        if (!evicted) break;
                        session.bytes -= evicted.length;
                        session.cache.delete(key);
                    }
                    session.cache.set(index, clear);
                    session.bytes += clear.length;
                }
                return clear;
            } catch (error: unknown) {
                if (mayRefresh && [401, 403].includes(statusOf(error) ?? 0)) {
                    if (session === current) await prepare();
                    return await segment(index, false);
                }
                throw error;
            } finally { session.downloads.delete(index); }
        })();
        session.downloads.set(index, task);
        return task;
    }
    return {
        source: async () => {
            const session = await ensure();
            return { fetchedAt: now(), expiresAt: session.expiresAt,
                quality: session.media.metadata.definition === 'FD' ? 'standard' : 'high' };
        },
        playlist: async () => (await ensure()).manifest.local,
        segment,
        dispose: () => { disposed = true; controller.abort(); current = null; },
    };
}

export async function getEpisodeLyrics(
    client: Pick<FanjiaoClient, 'get'>,
    audioId: string,
    readAsset: (url: string, signal?: AbortSignal, maxBytes?: number) => Promise<Buffer> = readMediaAsset,
    now: () => number = Date.now,
): Promise<FoliumSourceLyricsResult | null> {
    const payload: FanjiaoRecord = await client.get('/walkman/api/audio/info', { audio_id: requireId(audioId) });
    const subtitle = payload.subtitle;
    if (typeof subtitle !== 'string' || !subtitle) return null;
    const bytes = await readAsset(subtitle, undefined, 4 * 1024 * 1024);
    const document: unknown = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    return createFanjiaoLyrics(audioId, parseFanjiaoSubtitles(document, audioId), now);
}
