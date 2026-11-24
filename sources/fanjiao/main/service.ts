import { randomBytes } from 'node:crypto';
import type {
    FanjiaoAlbum, FanjiaoPage, FanjiaoParams, FanjiaoResponses, FanjiaoRpcResponse,
} from '../contracts';
import { albumDto, episodeDto, requireId } from './catalog';
import { createFanjiaoClient, type FanjiaoClient, type FanjiaoFetch, type FanjiaoFetchInit } from './client';
import { createEpisodeInfoCache, type EpisodeInfoCache } from './episodeInfoCache';
import { record, type FanjiaoRecord } from './normalize';
import { fetchPlaylistAlbums } from './playlists';
import { fetchRecommendedCollections, recommendationLimit } from './recommendations';
import {
    createPlaybackSession, getEpisodeLyrics, readMediaAsset, type FanjiaoPlaybackSession,
} from './session';
import { resolveVod, type FanjiaoResolveMedia } from './vod';

// sources/fanjiao/main/service.ts
// 白名单 RPC 操作、私有签名凭据，以及不可预测的本地 HLS 会话地址。所有上游授权与媒体地址都留在主进程。

const MAX_SESSIONS = 8;
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

type ErrorCode = 'unavailable' | 'not-playable' | 'invalid';
const withCode = (message: string, code: ErrorCode): Error & { code: ErrorCode } => Object.assign(new Error(message), { code });

const OPERATIONS: Record<keyof FanjiaoResponses, true> = {
    status: true, recommendations: true, searchAlbums: true, playlistAlbums: true, album: true,
    episodes: true, episode: true, lyrics: true, audioSource: true, hasAudio: true, closeAudio: true,
};
const isOperation = (value: string): value is keyof FanjiaoResponses => Object.hasOwn(OPERATIONS, value);

interface SessionEntry { session: FanjiaoPlaybackSession; audioId: string; touchedAt: number }
interface AlbumEntry { value: FanjiaoAlbum; at: number }

export interface FanjiaoServiceOptions {
    secret?: string;
    now?: () => number;
    client?: FanjiaoClient;
    fetch?: FanjiaoFetch;
    fetchMedia?: FanjiaoFetch;
    mediaUrl: (rest: string) => string;
    warn?: (message: string, details?: unknown) => void;
    randomToken?: () => string;
    resolveMedia?: FanjiaoResolveMedia;
    readAsset?: (url: string, signal?: AbortSignal, maxBytes?: number) => Promise<Buffer<ArrayBuffer>>;
}

export interface FanjiaoService {
    status(): { configured: boolean };
    request(operation: string, params?: FanjiaoParams): Promise<unknown>;
    rpc(operation: unknown, params: unknown): Promise<FanjiaoRpcResponse<unknown>>;
    handleMedia(path: string): Promise<Response>;
    dispose(): void;
}

export function createFanjiaoService(options: FanjiaoServiceOptions): FanjiaoService {
    const now = options.now ?? Date.now;
    const fetchImpl: FanjiaoFetch = options.fetch ?? ((url: string, init: FanjiaoFetchInit) => fetch(url, init));
    const readAsset: NonNullable<FanjiaoServiceOptions['readAsset']> = options.readAsset
        ?? ((url: string, signal?: AbortSignal, maxBytes?: number) => readMediaAsset(url, signal, maxBytes, options.fetchMedia ?? fetchImpl));
    const resolveMedia: FanjiaoResolveMedia = options.resolveMedia
        ?? ((payload: FanjiaoRecord, definition: string, signal: AbortSignal) => resolveVod(payload, definition, signal, fetchImpl));
    const warn: NonNullable<FanjiaoServiceOptions['warn']> = options.warn ?? (() => {});
    const upstreamClient = options.client
        ?? (options.secret ? createFanjiaoClient(options.secret, fetchImpl) : null);
    const client: EpisodeInfoCache | null = upstreamClient ? createEpisodeInfoCache(upstreamClient, { now }) : null;
    const sessions = new Map<string, SessionEntry>();
    const albums = new Map<string, AlbumEntry>();
    let disposed = false;
    const status = () => ({ configured: !!client && !disposed });
    const requireClient = (): EpisodeInfoCache => {
        if (disposed || !client) throw withCode('饭角尚未配置签名凭据', 'unavailable');
        return client;
    };
    const touch = (token: string, entry: SessionEntry) => {
        entry.touchedAt = now();
        sessions.delete(token);
        sessions.set(token, entry);
    };
    const prune = () => {
        for (const [token, entry] of sessions) {
            if (now() - entry.touchedAt > SESSION_IDLE_MS) {
                entry.session.dispose();
                sessions.delete(token);
            }
        }
        while (sessions.size > MAX_SESSIONS) {
            const first = sessions.entries().next().value;
            if (!first) break;
            const [token, entry] = first;
            entry.session.dispose();
            sessions.delete(token);
        }
    };
    const getAlbum = async (value: unknown): Promise<FanjiaoAlbum> => {
        const id = requireId(value);
        const cached = albums.get(id);
        if (cached && now() - cached.at < 60000) return cached.value;
        const album = albumDto(await requireClient().get('/walkman/api/album/album_info', { album_id: id }));
        if (albums.size >= 32) {
            const oldest = albums.keys().next().value;
            if (oldest !== undefined) albums.delete(oldest);
        }
        albums.set(id, { value: album, at: now() });
        return album;
    };
    const closeAudio = (params: FanjiaoParams): null => {
        const token = typeof params.token === 'string' ? params.token : '';
        const entry = sessions.get(token);
        if (entry) { entry.session.dispose(); sessions.delete(token); }
        return null;
    };
    const sweep = setInterval(prune, 60000);
    sweep.unref();

    async function request(operation: string, params: FanjiaoParams = {}): Promise<unknown> {
        const values: unknown = params;
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw withCode('Invalid Fanjiao request', 'invalid');
        if (!isOperation(operation)) throw withCode('Unsupported Fanjiao operation', 'invalid');
        const name = operation;
        if (name === 'status') return status();
        if (name === 'closeAudio') return closeAudio(params);
        if (name === 'hasAudio') {
            prune();
            const token = params.token ?? '';
            const entry = sessions.get(token);
            if (!entry) return false;
            touch(token, entry);
            return true;
        }
        const upstream = requireClient();
        switch (name) {
            case 'recommendations': return fetchRecommendedCollections(upstream, recommendationLimit(params.limit));
            case 'playlistAlbums':
                return fetchPlaylistAlbums(upstream, params.id, params.limit, params.offset);
            case 'searchAlbums': {
                const query = typeof params.query === 'string' ? params.query.trim() : '';
                const limit = params.limit ?? 30;
                const offset = params.offset ?? 0;
                if (!query || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50
                    || !Number.isSafeInteger(offset) || offset < 0 || offset % limit) {
                    throw withCode('Invalid Fanjiao search', 'invalid');
                }
                const page = offset / limit + 1;
                const data = await upstream.get('/walkman/api/search/keyword', { keyword: query, page, size: limit, type: 2 });
                const paging = record(data.paging);
                const list = data.list;
                const total = paging.total;
                if (!Array.isArray(list) || Number(paging.page) !== page || Number(paging.page_size) !== limit
                    || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
                    throw new Error('Invalid Fanjiao search response');
                }
                const entries: unknown[] = list;
                return { items: entries.map(record).map(item => albumDto(item)), total,
                    hasMore: page * limit < total, nextOffset: offset + limit } satisfies FanjiaoPage<FanjiaoAlbum>;
            }
            case 'album': return getAlbum(params.id);
            case 'episodes': {
                const id = requireId(params.id);
                const [album, data] = await Promise.all([
                    getAlbum(id),
                    upstream.get('/walkman/api/album/audio', { album_id: id }),
                ]);
                const list = data.audios_list;
                if (!Array.isArray(list)) throw new Error('Invalid Fanjiao episode list');
                const entries: unknown[] = list;
                return entries.map(record).map(raw => episodeDto(raw, album));
            }
            case 'episode': {
                const raw = await upstream.get('/walkman/api/audio/info', { audio_id: requireId(params.id) });
                return episodeDto(raw, await getAlbum(requireId(raw.album_id)));
            }
            case 'lyrics': return getEpisodeLyrics(upstream, requireId(params.id), readAsset, now);
            case 'audioSource': {
                const id = requireId(params.id);
                const definition = params.quality === 'standard' ? 'FD' : 'HQ';
                prune();
                const token = options.randomToken?.() ?? randomBytes(24).toString('hex');
                const session = createPlaybackSession(upstream, id, {
                    definition, now, readAsset, resolveMedia,
                });
                const entry: SessionEntry = { session, audioId: id, touchedAt: now() };
                sessions.set(token, entry);
                prune();
                try {
                    await session.source();
                    // A closeAudio or unload that won the race leaves no usable session; answer as a failed request.
                    if (disposed || sessions.get(token) !== entry) throw new Error('Fanjiao audio session closed');
                    return { url: options.mediaUrl(`${id}/${token}/index.m3u8`), token };
                } catch (error: unknown) {
                    session.dispose();
                    if (sessions.get(token) === entry) sessions.delete(token);
                    throw error;
                }
            }
            default: throw withCode('Unsupported Fanjiao operation', 'invalid');
        }
    }

    async function rpc(operation: unknown, params: unknown): Promise<FanjiaoRpcResponse<unknown>> {
        try {
            if (typeof operation !== 'string') throw withCode('Unsupported Fanjiao operation', 'invalid');
            if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
                throw withCode('Invalid Fanjiao request', 'invalid');
            }
            // Runtime-checked object; request() reads only the fields it knows and re-checks each one.
            const values = (params ?? {}) as FanjiaoParams;
            return { ok: true, data: await request(operation, values) };
        } catch (error: unknown) {
            const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            const code = errorCode === 'not-playable' ? 'not-playable'
                : errorCode === 'unavailable' ? 'not-configured'
                    : errorCode === 'invalid' ? 'invalid' : 'network';
            if (code === 'network') return { ok: false, code, message: '饭角请求失败，请稍后重试' };
            const message = error instanceof Error ? error.message : undefined;
            return message ? { ok: false, code, message } : { ok: false, code };
        }
    }

    async function handleMedia(path: string): Promise<Response> {
        // 只接受本站生成的播放列表和分片地址；token 不可预测，解析不能指定任意远端 URL 或文件路径。
        const match = /^([1-9]\d{0,14})\/([a-f0-9]{48})\/(index\.m3u8|segment\/(\d+)\.ts)$/.exec(path);
        if (!match) return new Response(null, { status: 404 });
        const audioId = match[1];
        const token = match[2];
        const file = match[3];
        prune();
        const entry = sessions.get(token);
        if (!entry || entry.audioId !== audioId) return new Response(null, { status: 410 });
        touch(token, entry);
        const isManifest = file === 'index.m3u8';
        try {
            const body = isManifest ? await entry.session.playlist() : await entry.session.segment(Number(match[4]));
            return new Response(body, { headers: {
                'Content-Type': isManifest ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
                'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
            } });
        } catch (error: unknown) {
            // 只记录可定位的分片编号与错误类别，不输出上游地址、签名或原始错误对象。
            const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
                ? error.status : 0;
            const kind = error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
                ? error.name : 'MediaError';
            if (!disposed) warn('[Fanjiao stream] Resource failed', { audioId: entry.audioId,
                resource: isManifest ? 'manifest' : `segment:${match[4]}`, kind, status });
            return new Response(null, { status: 502 });
        }
    }

    return {
        status,
        request,
        rpc,
        handleMedia,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            clearInterval(sweep);
            for (const { session } of sessions.values()) session.dispose();
            sessions.clear();
            albums.clear();
            client?.clear();
        },
    };
}
