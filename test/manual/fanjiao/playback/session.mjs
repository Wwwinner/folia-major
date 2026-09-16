import { resolveVod } from './vod.mjs';
import { decryptTransportStream, inspectTransportStream } from './transportStream.mjs';
import { parseFanjiaoSubtitles } from './subtitles.mjs';

// 固定福利分集的验证会话：按需取片、去重并缓存，密钥和上游地址不进入 renderer。
const audioId = 120361;
const trustedRoots = ['fanjiao.co', 'fanjiao.cn', 'rela.me', 'aliyuncs.com'];

function trustedUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !trustedRoots.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`))) {
        throw new Error('Unrecognized media host');
    }
    return url;
}

async function fetchAsset(value) {
    const response = await fetch(trustedUrl(value), { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
        const error = new Error(`Media HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return Buffer.from(await response.arrayBuffer());
}

function parseManifest(bytes, url) {
    const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines[0] !== '#EXTM3U' || !lines.includes('#EXT-X-ENDLIST')) throw new Error('Expected finite media playlist');
    const segments = lines.filter(line => line.trim() && !line.startsWith('#')).map(line => new URL(line.trim(), url).href);
    if (!segments.length || segments.length > 30) throw new Error('Unexpected sample segment count');
    let index = 0;
    const local = lines.filter(line => !/^#EXT-X-KEY:/i.test(line))
        .map(line => line.trim() && !line.startsWith('#') ? `/media/segment/${index++}.ts` : line).join('\n') + '\n';
    const duration = lines.filter(line => line.startsWith('#EXTINF:'))
        .reduce((sum, line) => sum + Number(line.slice(8).split(',')[0]), 0);
    return { local, segments, duration };
}

export function createPlaybackSession(client, { now = Date.now, onEvent = () => {},
    resolveMedia = resolveVod, readAsset = fetchAsset } = {}) {
    let current = null;
    let pending = null;
    const stats = { generations: 0, refreshes: 0, segmentDownloads: 0, cacheHits: 0,
        decryptMs: 0, streams: [], lastRefreshReason: null };
    // 同时到达的播放/预取请求共享一次授权刷新，失败后允许下一次显式重试。
    async function prepare(reason = 'initial') {
        if (pending) return pending;
        pending = (async () => {
            const payload = await client.get('/walkman/api/audio/info', { audio_id: audioId });
            if (payload.audio_id !== audioId || payload.album_id !== 111726 || payload.price !== 0
                || payload.is_public !== 1 || Number(payload.duration) > 60) {
                throw new Error('Sample metadata changed; recheck public sample');
            }
            const media = await resolveMedia(payload);
            const manifest = parseManifest(await readAsset(media.url), media.url);
            let lyrics = null;
            let subtitleWarning = null;
            try {
                const subtitles = JSON.parse((await readAsset(payload.subtitle)).toString('utf8').replace(/^\uFEFF/, ''));
                lyrics = parseFanjiaoSubtitles(subtitles, audioId).lyrics;
            } catch { subtitleWarning = '字幕暂时不可用'; }
            if (current) stats.refreshes += 1;
            stats.generations += 1;
            stats.lastRefreshReason = reason;
            current = { media, manifest, cache: new Map(),
                expiresAt: now() + Math.max(30, Number(payload.auth_timeout || 3000) - 60) * 1000,
                snapshot: { id: audioId, albumId: 111726, title: payload.name, duration: manifest.duration,
                    quality: media.metadata.definition, format: 'HLS / AAC',
                    segmentCount: manifest.segments.length, lyrics, subtitleWarning } };
            onEvent({ event: 'session-ready', generation: stats.generations,
                duration: manifest.duration, segments: manifest.segments.length, cueCount: lyrics?.lines.length || 0 });
            return current;
        })().finally(() => { pending = null; });
        return pending;
    }
    const ensure = () => !current ? prepare() : current.expiresAt <= now() ? prepare('local-expiry') : Promise.resolve(current);

    async function segment(index, mayRefresh = true) {
        const session = await ensure();
        if (!Number.isSafeInteger(index) || index < 0 || index >= session.manifest.segments.length) throw new Error('Invalid segment index');
        if (session.cache.has(index)) { stats.cacheHits += 1; return session.cache.get(index); }
        const task = (async () => {
            try {
                const encrypted = await readAsset(session.manifest.segments[index]);
                stats.segmentDownloads += 1;
                const start = performance.now();
                const clear = session.media.key ? decryptTransportStream(encrypted, session.media.key) : encrypted;
                stats.decryptMs += performance.now() - start;
                stats.streams = inspectTransportStream(clear);
                onEvent({ event: 'segment-ready', index, bytes: clear.length });
                return clear;
            } catch (error) {
                session.cache.delete(index);
                if (mayRefresh && [401, 403].includes(error.status)) {
                    if (session === current) await prepare('media-rejected');
                    return segment(index, false);
                }
                throw error;
            }
        })();
        session.cache.set(index, task);
        return task;
    }
    return {
        snapshot: async () => (await ensure()).snapshot,
        playlist: async () => (await ensure()).manifest.local,
        segment,
        expire: () => { if (current) current.expiresAt = 0; },
        stats: () => ({ ...stats, cachedSegments: current?.cache.size || 0 }),
    };
}
