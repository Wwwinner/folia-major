import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSearchCapture } from './searchCapture.mjs';

// 饭角只读接口核对：仅保存字段、状态和 URL 特征，不保存凭据或原始媒体响应。
const { values } = parseArgs({ options: {
    'secret-file': { type: 'string' },
    out: { type: 'string', default: 'test-results/fanjiao-contract.json' },
    keyword: { type: 'string', default: '白月光' },
    'album-id': { type: 'string', default: '111401' },
    mode: { type: 'string', default: 'full' },
    size: { type: 'string', default: '3' },
    ua: { type: 'string', default: 'app' },
    'omit-page': { type: 'boolean', default: false },
    'keyword-from-guide': { type: 'boolean', default: false },
    'context-har': { type: 'string' },
    'official-web-marker': { type: 'boolean', default: false },
} });
const credential = process.env.FANJIAO_SIGNATURE_SECRET
    || (values['secret-file'] ? (await readFile(values['secret-file'], 'utf8')).trim() : '');
if (!credential) throw new Error('Provide FANJIAO_SIGNATURE_SECRET or --secret-file.');
const albumId = Number(values['album-id']);
if (!Number.isSafeInteger(albumId) || albumId < 1) throw new Error('Invalid album ID.');
if (!['full', 'search', 'album'].includes(values.mode)) throw new Error('Invalid mode.');
if (values['official-web-marker'] && values.mode !== 'search') {
    throw new Error('The official Web marker comparison is restricted to search mode.');
}
if (!['app', 'default'].includes(values.ua)) throw new Error('Invalid UA option.');
const size = Number(values.size);
if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw new Error('Invalid search size.');
const deviceHeaders = {};
if (values['context-har'] && values['official-web-marker']) {
    throw new Error('Choose either a captured context or the official Web marker.');
}
if (values['context-har']) {
    const capture = await loadSearchCapture(values['context-har']);
    if (!capture.headers.sm_device) throw new Error('Capture has no sm_device context.');
    deviceHeaders.sm_device = capture.headers.sm_device;
}
// 官网 app.5085240e.js 的部分请求使用此标记；只作为显式兼容性对照，不自动兜底。
if (values['official-web-marker']) deviceHeaders.sm_device = '1';
const report = { observedAt: new Date().toISOString(), runtime: process.version,
    scope: 'Anonymous metadata and eligible free subtitle only; no VOD or audio download',
    contextSource: values['context-har'] ? 'local-har'
        : values['official-web-marker'] ? 'official-web-marker' : 'none',
    contextHeaderNames: Object.keys(deviceHeaders), requests: [] };

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sensitive = /secret|token|cookie|signature|play_auth|authinfo|plaintext|rand|decrypt_key/i;
const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

// 描述响应形状；字符串内容和敏感对象始终不进入核对产物。
function shape(value, depth = 0) {
    if (Array.isArray(value)) return { type: 'array', length: value.length,
        item: value.length && depth < 3 ? shape(value[0], depth + 1) : undefined };
    if (!object(value) || depth >= 3) return kind(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
        [key, sensitive.test(key) ? `${kind(item)} (redacted)` : shape(item, depth + 1)]));
}

function publicNumbers(value) {
    if (!object(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
        !sensitive.test(key) && (typeof item === 'number' || typeof item === 'boolean' || item === null)));
}

function urlTraits(value) {
    if (typeof value !== 'string' || !value) return { present: false };
    try {
        const url = new URL(value);
        return { present: true, protocol: url.protocol, host: url.hostname,
            extension: extname(url.pathname), queryKeys: [...new Set(url.searchParams.keys())].sort() };
    } catch { return { present: true, validUrl: false, length: value.length }; }
}

function safeMessage(value) {
    if (typeof value !== 'string') return undefined;
    let result = value.replaceAll(credential, '[redacted]');
    if (values['context-har']) {
        for (const context of Object.values(deviceHeaders)) result = result.replaceAll(context, '[redacted]');
    }
    return result
        .replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9_+/=-]{24,}/g, '[redacted]')
        .slice(0, 200);
}

async function save() {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
}

// 每组参数只发一次有超时的 GET；HTTP 成功与业务成功分别记录。
async function request(label, path, params) {
    const canonical = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
    const signature = createHash('md5').update(canonical + credential).digest('hex');
    const headers = { signature, ...deviceHeaders };
    if (values.ua === 'app') headers['user-agent'] = 'fanjiao/3.15.1 140 Android 15';
    const record = { label, method: 'GET', path, params, body: false,
        explicitHeaderNames: Object.keys(headers) };
    report.requests.push(record);
    const start = performance.now();
    try {
        const response = await fetch(`https://api.fanjiao.co${path}?${new URLSearchParams(params)}`, {
            headers,
            signal: AbortSignal.timeout(20000), redirect: 'error',
        });
        record.httpStatus = response.status;
        record.responseCookieNames = response.headers.getSetCookie().map(cookie => cookie.split('=', 1)[0]);
        const document = await response.json();
        record.businessCode = ['string', 'number'].includes(typeof document?.code) ? document.code : null;
        record.shape = shape(document);
        record.success = response.ok && [0, '0'].includes(document?.code) && object(document?.data);
        if (!record.success) record.businessMessage = safeMessage(document?.message ?? document?.msg);
        record.elapsedMs = Math.round(performance.now() - start);
        await save();
        console.log(JSON.stringify({ label, httpStatus: record.httpStatus,
            businessCode: record.businessCode, businessMessage: record.businessMessage,
            success: record.success, elapsedMs: record.elapsedMs }));
        return { record, data: record.success ? document.data : null };
    } catch (error) {
        record.error = { name: error.name, code: error.cause?.code || null };
        await save();
        console.log(JSON.stringify({ label, error: record.error }));
        return { record, data: null };
    }
}

async function probeSearch() {
    let keyword = values.keyword;
    if (values['keyword-from-guide']) {
        const guide = await request('search-guide', '/walkman/api/search/guide', {});
        keyword = guide.data?.guide_word || guide.data?.guide_words?.[0];
        if (typeof keyword !== 'string' || !keyword.trim()) {
            guide.record.usableKeyword = false;
            return;
        }
        guide.record.usableKeyword = true;
    }
    for (const page of values['omit-page'] ? [1] : [1, 2]) {
        const params = { keyword, size, type: 2 };
        if (!values['omit-page']) params.page = page;
        const result = await request(`search-page-${page}`, '/walkman/api/search/keyword',
            params);
        result.record.paging = publicNumbers(result.data?.paging);
        result.record.albumIds = Array.isArray(result.data?.list)
            ? result.data.list.filter(object).map(item => item.album_id ?? item.id) : [];
        if (!result.data) break;
    }
}

// 零价格并且明确有资格才取字幕；摘要不包含字幕正文或播放凭据。
async function probeSubtitle(record, data, item) {
    const eligible = [true, 1].includes(data.access_info?.user_has_eligibility);
    if (item.price !== 0 || data.price !== 0 || !eligible || !data.subtitle) {
        record.subtitleProbe = { skipped: 'Zero price, explicit eligibility and subtitle URL required' };
        return;
    }
    try {
        const url = new URL(data.subtitle);
        if (url.protocol !== 'https:' || url.username || url.password || url.port
            || !['static.rela.me', 'static.fanjiao.co'].includes(url.hostname)) {
            record.subtitleProbe = { skipped: 'Unconfirmed subtitle host' };
            return;
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
        const document = await response.json();
        const cues = Array.isArray(document?.content) ? document.content.filter(object) : [];
        const timestamp = value => typeof value === 'string' && /^\d+:\d+:\d+(?::\d+)?$/.test(value)
            ? value : '(unknown format)';
        record.subtitleProbe = { httpStatus: response.status, shape: shape(document),
            cues: cues.length, examples: cues.slice(0, 3).map(cue => ({
                fieldNames: Object.keys(cue), textLength: String(cue.content || '').length,
                start: timestamp(cue.newStart || cue.startTime), end: timestamp(cue.newEnd || cue.endTime),
            })) };
    } catch (error) { record.subtitleProbe = { errorName: error.name }; }
}

// 保持目录顺序，并从同一专辑各选至多一个零价格、正价格样本核对单集详情。
async function probeAlbum() {
    const album = await request('album-detail', '/walkman/api/album/album_info', { album_id: albumId });
    album.record.flags = publicNumbers(album.data);
    const episodes = await request('album-episodes', '/walkman/api/album/audio', { album_id: albumId });
    episodes.record.flags = publicNumbers(episodes.data);
    const list = Array.isArray(episodes.data?.audios_list) ? episodes.data.audios_list.filter(object) : [];
    episodes.record.episodes = list.map(item => ({
        audioId: item.audio_id, fields: publicNumbers(item),
        src: urlTraits(item.src), subtitle: urlTraits(item.subtitle),
    }));
    const candidates = [list.find(item => item.price === 0), list.find(item => Number(item.price) > 0)];
    episodes.record.sampleCoverage = { zeroPrice: !!candidates[0], positivePrice: !!candidates[1] };
    for (const item of candidates.filter((entry, index, all) => entry && all.indexOf(entry) === index)) {
        const result = await request(`audio-info-price-${item.price === 0 ? 'zero' : 'positive'}`,
            '/walkman/api/audio/info', { audio_id: item.audio_id });
        if (!result.data) continue;
        const data = result.data;
        result.record.flags = publicNumbers(data);
        result.record.accessFlags = publicNumbers(data.access_info);
        result.record.src = urlTraits(data.src);
        result.record.subtitle = urlTraits(data.subtitle);
        result.record.hasPlayAuth = typeof data.play_auth === 'string' && data.play_auth.length > 0;
        result.record.hasEncryptSrc = typeof data.encrypt_src === 'string' && data.encrypt_src.length > 0;
        result.record.encryptInfosShape = shape(data.encrypt_infos);
        result.record.definitions = Array.isArray(data.encrypt_infos) ? data.encrypt_infos.filter(object).map(track => ({
            definition: typeof track.definition === 'string' && /^[A-Z0-9]{1,8}$/.test(track.definition)
                ? track.definition : '(unknown)', size: typeof track.size === 'number' ? track.size : undefined,
        })) : [];
        await probeSubtitle(result.record, data, item);
    }
}

if (values.mode !== 'album') await probeSearch();
if (values.mode !== 'search') await probeAlbum();
await save();
if (report.requests.some(record => !record.success)) process.exitCode = 1;
console.log(`Sanitized report: ${values.out}`);
