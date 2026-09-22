import type { SongResult } from '../types';
import { getEpisodeKey, type EpisodeProgress } from '../utils/episodePlayback';
import { getAssignedAudioSource, isSegmentedAudioSource, isEpisodeSource } from './playbackMediaSource';
import { episodeMetadataFromSong } from '../utils/episodeHistory';

// 每个音频节点绑定固定分集身份；5 秒节流，暂停/跳转/切源/退出立即保存，加载归零不覆盖历史。
export function createEpisodeProgressRecorder(audio: HTMLAudioElement, song: SongResult, source: string,
    save: (key: string, value: EpisodeProgress) => void, now = Date.now) {
    const key = getEpisodeKey(song);
    if (!key || !isEpisodeSource(key, source)) return () => {};
    let ready = false;
    let completed = false;
    let interacted = false;
    let snapshot: EpisodeProgress | null = null;
    let lastWrite = -Infinity;
    let lastPlayedAt = 0;
    const metadata = episodeMetadataFromSong(song);
    const matches = () => getAssignedAudioSource(audio) === source && audio.readyState >= 1 && !audio.error
        && (!isSegmentedAudioSource(source) || audio.currentSrc === audio.getAttribute('src'));
    const commit = () => {
        if (!snapshot) return;
        save(key, snapshot);
        lastWrite = now();
        snapshot = null;
    };
    const capture = (flush = false) => {
        if (!ready || !interacted || !matches() || audio.seeking || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        if (!audio.paused || audio.ended) lastPlayedAt = now();
        snapshot = { position: Math.min(audio.duration, Math.max(0, audio.currentTime)), duration: audio.duration,
            completed, updatedAt: now(), lastPlayedAt, metadata };
        if (flush || now() - lastWrite >= 5000) commit();
    };
    const loaded = () => { ready = matches(); };
    const playing = () => { loaded(); interacted = true; completed = false; capture(true); };
    const tick = () => { if (!audio.paused) capture(); };
    const flush = () => { capture(true); commit(); };
    const ended = () => { completed = true; capture(true); };
    const emptied = () => { ready = false; };
    const seeked = () => { if (ready && matches() && audio.currentTime > 0) interacted = true; flush(); };
    const handlers = { loadedmetadata: loaded, playing, timeupdate: tick, pause: flush, seeked, ended, emptied };
    for (const [event, handler] of Object.entries(handlers)) audio.addEventListener(event, handler);
    const view = audio.ownerDocument?.defaultView;
    view?.addEventListener('pagehide', flush);
    view?.addEventListener('beforeunload', flush);
    if (audio.readyState >= 1) loaded();
    return () => {
        flush();
        for (const [event, handler] of Object.entries(handlers)) audio.removeEventListener(event, handler);
        view?.removeEventListener('pagehide', flush);
        view?.removeEventListener('beforeunload', flush);
    };
}
