import { isFanjiaoKey } from '../../../shared/fanjiaoSync.mjs';
import type { FanjiaoSyncData } from '../../../shared/fanjiaoSync.mjs';
import type { EpisodeHistoryMetadata, EpisodeProgress } from '../../utils/episodePlayback';
import { FanjiaoLocalState } from './fanjiaoLocalState';
import { getSyncConfig } from './syncConfig';

// Keeps remote winners separate from live audio sessions; this module never controls playback.
type Progress = Record<string, EpisodeProgress>;
let journal: FanjiaoLocalState | undefined;
const sessions = new Map<string, { count: number; blocked: boolean; hidden: boolean }>();
function local(progress: Progress) {
    const scope = getSyncConfig().fanjiaoScope || 'local';
    journal ??= new FanjiaoLocalState(typeof localStorage === 'undefined' ? null : localStorage, scope, progress);
    journal.ensureScope(scope, progress);
    return journal;
}

export function beginFanjiaoSession(key: string) {
    if (!isFanjiaoKey(key)) return;
    const session = sessions.get(key);
    if (session) session.count++;
    else sessions.set(key, { count: 1, blocked: false, hidden: false });
}

export const isFanjiaoSessionHidden = (key: string) => sessions.get(key)?.hidden === true;

function project(progress: Progress): Progress {
    const state = local(progress);
    const known = new Set(state.history.records.map(row => row.key));
    const next = Object.fromEntries(Object.entries(progress).filter(([key]) => !isFanjiaoKey(key)
        || (!known.has(key) && state.history.epoch.counter === 0)));
    for (const row of state.history.records) if (!row.deleted && row.value) next[row.key] = {
        ...row.value, ...(row.value.metadata || !progress[row.key]?.metadata ? {} : { metadata: progress[row.key].metadata }),
    };
    for (const [key] of sessions) {
        if (progress[key]) next[key] = progress[key];
        else delete next[key];
    }
    return next;
}

export function endFanjiaoSession(key: string, progress: Progress): Progress {
    const session = sessions.get(key);
    if (!session) return progress;
    if (--session.count > 0) return progress;
    sessions.delete(key);
    return project(progress);
}

export function recordFanjiaoProgress(key: string, value: EpisodeProgress, progress: Progress) {
    if (!isFanjiaoKey(key) || sessions.get(key)?.blocked) return;
    local(progress).save(key, value, sessions.has(key));
}

export function resetFanjiaoEpisode(key: string, value: EpisodeProgress | null, progress: Progress) {
    if (!isFanjiaoKey(key)) return;
    local(progress).reset(key, value);
    const session = sessions.get(key);
    if (session) { session.blocked = !value; session.hidden = !value; }
}

export function clearFanjiaoHistory(progress: Progress) {
    local(progress).clear();
    for (const session of sessions.values()) { session.blocked = true; session.hidden = true; }
}

export function hydrateFanjiaoMetadata(key: string, metadata: EpisodeHistoryMetadata, progress: Progress) {
    if (isFanjiaoKey(key)) local(progress).hydrate(key, metadata);
}

export function exportFanjiaoData(progress: Progress) {
    const state = local(progress);
    const known = new Set(state.history.records.map(row => row.key));
    for (const [key, value] of Object.entries(progress)) {
        if (!known.has(key) && !sessions.get(key)?.blocked) state.save(key, value);
    }
    return state.export();
}

// Merge only after a complete validated download. Active sessions keep their display and cannot re-upload stale progress.
export function mergeFanjiaoData(data: FanjiaoSyncData, progress: Progress) {
    const state = local(progress);
    const before = new Map(state.history.records.map(row => [row.key, JSON.stringify(row)]));
    const epoch = JSON.stringify(state.history.epoch);
    state.merge(data);
    if (data.history) {
        const after = new Map(state.history.records.map(row => [row.key, JSON.stringify(row)]));
        for (const [key, session] of sessions) {
            if (epoch !== JSON.stringify(state.history.epoch) || before.get(key) !== after.get(key)) session.blocked = true;
        }
    }
    return data.history ? project(progress) : progress;
}

export function persistFanjiaoOperation(operation: () => void) {
    try { operation(); }
    catch (error) { console.warn('[Episodes] Sync journal could not be saved', error); }
}

export function restoreFanjiaoState(progress: Progress) {
    try {
        return project(progress);
    } catch { return progress; }
}
