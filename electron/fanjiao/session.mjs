import { resolveVod } from './vod.mjs';
import { decryptTransportStream } from './transportStream.mjs';
import { parseFanjiaoSubtitles } from './subtitles.mjs';
import { hasEpisodeMediaAuthorization, requireId } from './catalog.mjs';
import { setTimeout as delay } from 'node:timers/promises';

// 按需处理 HLS 分片；会话内共享刷新与下载，有限缓存，销毁时取消未完成的请求。
const trustedRoots = ['fanjiao.co', 'fanjiao.cn', 'rela.me', 'aliyuncs.com'];
export function trustedMediaUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !trustedRoots.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`))) {
        throw new Error('Unrecognized Fanjiao media host');
    }
    return url;
}

export async function readMediaAsset(value, signal, maxBytes = 16 * 1024 * 1024, fetchMedia = fetch) {
    const url = trustedMediaUrl(value);
    // 高音质分片约为标准音质的四倍；完整下载预算与 renderer 的 65 秒等待配套。
    const timeout = AbortSignal.timeout(url.pathname.endsWith('.ts') ? 60000 : 20000);
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    for (let attempt = 0; ; attempt++) {
        try { return await readMediaAttempt(url, deadline, maxBytes, fetchMedia); }
        catch (error) {
            const transient = error instanceof TypeError || [408, 429, 500, 502, 503, 504].includes(error.status)
                || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code);
            if (deadline.aborted || attempt >= 2 || !transient) throw error;
            // 所有重试共用原始截止时间，不把一次下载等待重复放大。
            await delay(250 * (attempt + 1), undefined, { signal: deadline });
        }
    }
}

async function readMediaAttempt(url, signal, maxBytes, fetchMedia) {
    const response = await fetchMedia(url, { redirect: 'error', signal });
    if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`Media HTTP ${response.status}`), { status: response.status });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Fanjiao asset exceeds size limit');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

export function parseManifest(bytes, baseUrl) {
    const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== '#EXTM3U' || !lines.includes('#EXT-X-ENDLIST')
        || lines.some(line => /^#EXT-X-(?:MAP|STREAM-INF|BYTERANGE):/.test(line))) {
        throw new Error('Unsupported Fanjiao media playlist');
    }
    const segments = lines.filter(line => line && !line.startsWith('#'))
        .map(line => trustedMediaUrl(new URL(line, baseUrl)).href);
    if (!segments.length || segments.length > 10000) throw new Error('Invalid Fanjiao segment count');
    let index = 0;
    const local = lines.filter(line => !/^#EXT-X-KEY:/i.test(line))
        .map(line => line && !line.startsWith('#') ? `segment/${index++}.ts` : line).join('\n') + '\n';
    return { local, segments };
}

export function createPlaybackSession(client, audioId, { definition = 'FD', now = Date.now,
    resolveMedia = resolveVod, readAsset = readMediaAsset, maxCacheBytes = 8 * 1024 * 1024 } = {}) {
    requireId(audioId);
    const controller = new AbortController();
    let current = null;
    let pending = null;
    let disposed = false;
    const assertAlive = () => { if (disposed) throw new Error('Fanjiao session disposed'); };
    // 新旧请求竞争时只安装一个新授权；每次失败最多刷新一次。
    async function prepare() {
        assertAlive();
        if (pending) return pending;
        pending = (async () => {
            const payload = await client.get('/walkman/api/audio/info', { audio_id: audioId }, controller.signal, { fresh: true });
            if (String(payload.audio_id) !== String(audioId)) throw new Error('Unexpected Fanjiao episode');
            if (!hasEpisodeMediaAuthorization(payload)) throw Object.assign(new Error('饭角未返回这集的播放授权，暂时无法播放'), { code: 'not-playable' });
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
    const ensure = () => {
        assertAlive();
        return !current || current.expiresAt <= now() ? prepare() : Promise.resolve(current);
    };

    async function segment(index, mayRefresh = true) {
        const session = await ensure();
        if (!Number.isSafeInteger(index) || index < 0 || index >= session.manifest.segments.length) throw new Error('Invalid segment index');
        if (session.cache.has(index)) {
            const bytes = session.cache.get(index);
            session.cache.delete(index);
            session.cache.set(index, bytes);
            return bytes;
        }
        if (session.downloads.has(index)) return session.downloads.get(index);
        const task = (async () => {
            try {
                const bytes = await readAsset(session.manifest.segments[index], controller.signal);
                assertAlive();
                const clear = session.media.key ? decryptTransportStream(bytes, session.media.key) : bytes;
                if (clear.length <= maxCacheBytes) {
                    while (session.bytes + clear.length > maxCacheBytes && session.cache.size) {
                        const key = session.cache.keys().next().value;
                        session.bytes -= session.cache.get(key).length;
                        session.cache.delete(key);
                    }
                    session.cache.set(index, clear);
                    session.bytes += clear.length;
                }
                return clear;
            } catch (error) {
                if (mayRefresh && [401, 403].includes(error.status)) {
                    if (session === current) await prepare();
                    return segment(index, false);
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

export async function getEpisodeLyrics(client, audioId, readAsset = readMediaAsset) {
    const payload = await client.get('/walkman/api/audio/info', { audio_id: requireId(audioId) });
    if (!payload.subtitle) return { lyrics: null, isPureMusic: false };
    const bytes = await readAsset(payload.subtitle, undefined, 4 * 1024 * 1024);
    return { lyrics: parseFanjiaoSubtitles(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), audioId).lyrics,
        isPureMusic: false };
}
