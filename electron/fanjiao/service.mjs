import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createFanjiaoClient } from './client.mjs';
import { albumDto, episodeDto, requireId } from './catalog.mjs';
import { createPlaybackSession, getEpisodeLyrics, readMediaAsset } from './session.mjs';
import { createFanjiaoDiscovery } from './discovery.mjs';
import { createEpisodeInfoCache } from './episodeInfoCache.mjs';

// Electron 饭角服务：白名单 IPC 操作、私有凭据读取，以及不可预测的本地 HLS 会话地址。
export const FANJIAO_SCHEME = 'folia-hls';
const MAX_SESSIONS = 8;
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

export function readSigningSecret({ appPath, userData, isDev }) {
    if (process.env.FANJIAO_SIGNATURE_SECRET?.trim()) return process.env.FANJIAO_SIGNATURE_SECRET.trim();
    const filename = process.env.FANJIAO_SIGNATURE_SECRET_FILE
        || path.join(isDev ? appPath : userData, '.fanjiao.secret');
    try { return readFileSync(filename, 'utf8').trim(); } catch { return ''; }
}

export function createFanjiaoService({ secret, now = Date.now, client: injectedClient, mediaTransport } = {}) {
    const upstreamClient = injectedClient || (secret ? createFanjiaoClient(secret) : null);
    const client = upstreamClient ? createEpisodeInfoCache(upstreamClient, { now }) : null;
    const readAsset = (url, signal, maxBytes) => readMediaAsset(url, signal, maxBytes, mediaTransport?.fetch);
    const sessions = new Map();
    const albums = new Map();
    let disposed = false;
    const status = () => ({ configured: !!client && !disposed });
    const requireClient = () => {
        if (disposed || !client) throw Object.assign(new Error('饭角尚未配置签名凭据'), { code: 'unavailable' });
        return client;
    };
    const discovery = createFanjiaoDiscovery(requireClient, now);
    const touch = (token, entry) => {
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
            const [token, entry] = sessions.entries().next().value;
            entry.session.dispose();
            sessions.delete(token);
        }
    };
    const getAlbum = async id => {
        requireId(id);
        const cached = albums.get(String(id));
        if (cached && now() - cached.at < 60000) return cached.value;
        const value = albumDto(await requireClient().get('/walkman/api/album/album_info', { album_id: id }));
        if (albums.size >= 32) albums.delete(albums.keys().next().value);
        albums.set(String(id), { value, at: now() });
        return value;
    };
    const sweep = setInterval(prune, 60000);
    sweep.unref?.();
    async function request(operation, params = {}) {
        requireClient();
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid Fanjiao request');
        switch (operation) {
            case 'homeSections':
            case 'sectionAlbums':
            case 'browseFilters':
            case 'browseAlbums': return discovery.request(operation, params);
            case 'searchAlbums': {
                const query = typeof params.query === 'string' ? params.query.trim() : '';
                const limit = params.limit ?? 30;
                const offset = params.offset ?? 0;
                if (!query || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50
                    || !Number.isSafeInteger(offset) || offset < 0 || offset % limit) throw new Error('Invalid Fanjiao search');
                const page = offset / limit + 1;
                const data = await client.get('/walkman/api/search/keyword', { keyword: query, page, size: limit, type: 2 });
                if (!Array.isArray(data.list) || Number(data.paging?.page) !== page
                    || Number(data.paging?.page_size) !== limit || !Number.isSafeInteger(data.paging?.total)
                    || data.paging.total < 0) throw new Error('Invalid Fanjiao search response');
                return { items: data.list.map(albumDto), total: data.paging.total,
                    hasMore: page * limit < data.paging.total, nextOffset: offset + limit };
            }
            case 'album': return getAlbum(requireId(params.id));
            case 'episodes': {
                const id = requireId(params.id);
                const [album, data] = await Promise.all([getAlbum(id), client.get('/walkman/api/album/audio', { album_id: id })]);
                if (!Array.isArray(data.audios_list)) throw new Error('Invalid Fanjiao episode list');
                return data.audios_list.map(raw => episodeDto(raw, album));
            }
            case 'episode': {
                const raw = await client.get('/walkman/api/audio/info', { audio_id: requireId(params.id) });
                return episodeDto(raw, await getAlbum(requireId(raw.album_id)));
            }
            case 'lyrics': return getEpisodeLyrics(client, requireId(params.id), readAsset);
            case 'audioSource': {
                const id = requireId(params.id);
                const definition = params.quality === 'standard' ? 'FD' : 'HQ';
                prune();
                const token = randomBytes(24).toString('hex');
                const session = createPlaybackSession(client, id, { definition, now, readAsset });
                const entry = { session, audioId: id, touchedAt: now() };
                sessions.set(token, entry);
                prune();
                try {
                    const source = await session.source();
                    return { ...source, url: `${FANJIAO_SCHEME}://fanjiao/${id}/${token}/index.m3u8` };
                } catch (error) { session.dispose(); sessions.delete(token); throw error; }
            }
            default: throw new Error('Unsupported Fanjiao operation');
        }
    }
    // 只接受本站生成的 manifest / segment 地址；请求不能指定任意远端 URL 或文件路径。
    async function handleProtocol(request) {
        const url = new URL(request.url);
        const match = /^\/([1-9]\d{0,14})\/([a-f0-9]{48})\/(index\.m3u8|segment\/(\d+)\.ts)$/.exec(url.pathname);
        if (request.method !== 'GET' || url.hostname !== 'fanjiao' || url.search || !match) return new Response(null, { status: 404 });
        prune();
        const entry = sessions.get(match[2]);
        if (!entry || entry.audioId !== match[1]) return new Response(null, { status: 410 });
        touch(match[2], entry);
        try {
            const isManifest = match[3] === 'index.m3u8';
            const body = isManifest ? await entry.session.playlist() : await entry.session.segment(Number(match[4]));
            return new Response(body, { headers: { 'Content-Type': isManifest ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
                'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
        } catch (error) {
            // 只记录可定位的分片编号与错误类别，不输出上游地址、签名或原始错误对象。
            const kind = ['TimeoutError', 'AbortError', 'TypeError'].includes(error?.name) ? error.name : 'MediaError';
            if (!disposed) console.warn('[Fanjiao stream] Resource failed', entry.audioId,
                match[4] === undefined ? 'manifest' : `segment:${match[4]}`, kind,
                Number.isInteger(error?.status) ? error.status : 0);
            return new Response(null, { status: 502 });
        }
    }
    return { status, request, handleProtocol, dispose: () => {
        disposed = true;
        clearInterval(sweep);
        for (const { session } of sessions.values()) session.dispose();
        sessions.clear();
        albums.clear();
        discovery.clear();
        client?.clear();
        mediaTransport?.dispose();
    } };
}
