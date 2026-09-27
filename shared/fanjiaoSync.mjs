// Pure, deployment-independent protocol shared by the browser, Node and Workers.
export const FANJIAO_PROTOCOL = 1;
export const MAX_FANJIAO_BATCH = 100;
export const MAX_FANJIAO_RECORDS = 10000;
export const MAX_FANJIAO_BODY = 1024 * 1024;
export const ZERO_VERSION = Object.freeze({ counter: 0, device: '' });
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const time = value => Number.isSafeInteger(value) && value >= 0 && value < 8640000000000000;
export const isFanjiaoKey = value => typeof value === 'string' && /^online:fanjiao:[a-zA-Z0-9_-]{1,128}$/.test(value);
export const compareVersion = (a, b) => a.counter - b.counter || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);
export const versionKey = version => `${String(version.counter).padStart(16, '0')}:${version.device.padEnd(64, ' ')};`;
export const recordOrder = record => `${versionKey(record.epoch)}${versionKey(record.generation)}${versionKey(record.version)}${record.value?.metadata ? '1' : '0'}`;
// ASCII canonical JSON gives JavaScript and SQLite BINARY the same tie-break order, including emoji.
export const recordPayload = record => JSON.stringify(parseFanjiaoRecord(record))
    .replace(/[^\x20-\x7e]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function parseVersion(value) {
    if (!object(value) || !time(value.counter) || !text(value.device, 64)) return null;
    if (value.counter === 0 ? value.device !== '' : !/^[a-zA-Z0-9_-]{1,64}$/.test(value.device)) return null;
    return { counter: value.counter, device: value.device };
}

function coverReference(value) {
    try {
        const url = new URL(value);
        // Never export local resources, credentials, signed queries or media playback URLs.
        if (url.protocol !== 'https:' || url.username || url.password || url.port
            || !/^[a-zA-Z][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(url.hostname)
            || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
            || !/\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) return '';
        return `${url.origin}${url.pathname}`;
    } catch { return ''; }
}

export function parseEpisodeValue(value) {
    if (!object(value) || !Number.isFinite(value.position) || !Number.isFinite(value.duration)
        || value.position < 0 || value.duration <= 0 || value.duration > 604800 || value.position > value.duration
        || typeof value.completed !== 'boolean' || !time(value.updatedAt)
        || (value.lastPlayedAt !== undefined && !time(value.lastPlayedAt))) return null;
    const result = { position: value.position, duration: value.duration, completed: value.completed, updatedAt: value.updatedAt };
    if (value.lastPlayedAt !== undefined) result.lastPlayedAt = value.lastPlayedAt;
    if (value.metadata !== undefined) {
        const m = value.metadata;
        if (!object(m) || !text(m.name, 512) || !text(m.albumId, 128) || !m.albumId
            || !text(m.albumName, 512) || !text(m.author, 512) || !text(m.coverUrl, 2048)
            || !['main', 'extra', 'unknown'].includes(m.kind)) return null;
        result.metadata = { name: m.name, albumId: m.albumId, albumName: m.albumName,
            coverUrl: coverReference(m.coverUrl), author: m.author, kind: m.kind };
    }
    return result;
}

export function parseFanjiaoRecord(value) {
    if (!object(value) || !isFanjiaoKey(value.key) || typeof value.deleted !== 'boolean') return null;
    const epoch = parseVersion(value.epoch), generation = parseVersion(value.generation), version = parseVersion(value.version);
    if (!epoch || !generation || !version || version.counter === 0
        || compareVersion(version, epoch) < 0 || compareVersion(version, generation) < 0) return null;
    const progress = value.deleted ? null : parseEpisodeValue(value.value);
    if (value.deleted ? value.value !== null || generation.counter === 0 : !progress) return null;
    return { key: value.key, epoch, generation, version, deleted: value.deleted, value: progress };
}

export function parseFanjiaoSyncData(value, limit = MAX_FANJIAO_BATCH) {
    if (!object(value) || value.protocol !== FANJIAO_PROTOCOL || (value.history === undefined && value.preference === undefined)) return null;
    const result = { protocol: FANJIAO_PROTOCOL };
    if (value.history !== undefined) {
        const h = value.history, epoch = object(h) && parseVersion(h.epoch);
        if (!epoch || !Array.isArray(h.records) || h.records.length > limit) return null;
        const records = h.records.map(parseFanjiaoRecord);
        if (records.some(row => !row || compareVersion(row.epoch, epoch) !== 0)
            || new Set(records.map(row => row.key)).size !== records.length) return null;
        result.history = { epoch, records };
    }
    if (value.preference !== undefined) {
        if (value.preference === null) result.preference = null;
        else {
            const p = value.preference, version = object(p) && parseVersion(p.version);
            if (!version || !version.counter || typeof p.mainOnly !== 'boolean') return null;
            result.preference = { version, mainOnly: p.mainOnly };
        }
    }
    return result;
}

// Reset generations and clear epochs outrank progress, including unseen offline writes.
export function mergeFanjiaoHistory(a, b) {
    const epoch = compareVersion(a.epoch, b.epoch) >= 0 ? a.epoch : b.epoch;
    const rows = new Map();
    for (const row of [...a.records, ...b.records]) {
        if (compareVersion(row.epoch, epoch) !== 0) continue;
        const previous = rows.get(row.key);
        const order = recordOrder(row), previousOrder = previous && recordOrder(previous);
        if (!previous || order > previousOrder || (order === previousOrder && recordPayload(row) > recordPayload(previous))) rows.set(row.key, row);
    }
    return { epoch, records: [...rows.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
}

export function mergeFanjiaoPreference(a, b) {
    if (!a || !b) return a ?? b;
    const order = compareVersion(a.version, b.version);
    return order > 0 || (order === 0 && a.mainOnly) ? a : b;
}
