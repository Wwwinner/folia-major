import type { SongResult } from '../types';
import { getEpisodeKey } from '../utils/episodePlayback';
import { getAssignedAudioSource, isEpisodeSource } from './playbackMediaSource';

// 相邻集的网络预取让位于当前集：开始播放且至少缓冲 30 秒（或已缓冲至结尾）后再启动。
export function waitForEpisodePrefetchReadiness(song: SongResult, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const key = getEpisodeKey(song);
    if (!key) return Promise.resolve(true);
    if (typeof document === 'undefined') return Promise.resolve(false);
    const events = ['playing', 'progress', 'timeupdate', 'canplay', 'seeked'];
    return new Promise(resolve => {
        const finish = (ready: boolean) => {
            events.forEach(event => document.removeEventListener(event, check, true));
            signal.removeEventListener('abort', cancel);
            resolve(ready);
        };
        const cancel = () => finish(false);
        const check = () => {
            if (signal.aborted) { cancel(); return; }
            for (const media of document.querySelectorAll('audio')) {
                if (!isEpisodeSource(key, getAssignedAudioSource(media) || '') || media.paused || media.seeking
                    || media.ended || media.readyState < 3) continue;
                for (let index = 0; index < media.buffered.length; index++) {
                    const end = media.buffered.end(index);
                    if (media.buffered.start(index) <= media.currentTime && end > media.currentTime
                        && (end - media.currentTime >= 30 || (Number.isFinite(media.duration) && end >= media.duration - 0.25))) {
                        finish(true); return;
                    }
                }
            }
        };
        signal.addEventListener('abort', cancel, { once: true });
        events.forEach(event => document.addEventListener(event, check, true));
        check();
    });
}
