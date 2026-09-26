import type { SongResult } from '../types';
import { getEpisodeKey } from '../utils/episodePlayback';

// 音频逻辑地址与 MSE blob 分开保存，供双音轨、重试和缓存共同判断。
const episodeOwners = new Map<string, string>();
export function rememberEpisodeSource(song: SongResult, source: string): string {
    const key = getEpisodeKey(song);
    if (key) {
        episodeOwners.delete(source);
        episodeOwners.set(source, key);
        if (episodeOwners.size > 200) episodeOwners.delete(episodeOwners.keys().next().value!);
    }
    return source;
}
export const isEpisodeSource = (key: string, source: string) => episodeOwners.get(source) === key;
const segmentedSources = new WeakMap<HTMLMediaElement, string>();
export const isSegmentedAudioSource = (src: string | null | undefined): boolean => !!src?.startsWith('folia-hls://');
export const getLogicalAudioSource = (element: HTMLMediaElement | null | undefined): string | null => element
    ? segmentedSources.get(element) || element.currentSrc || element.getAttribute('src') : null;
export const getAssignedAudioSource = (element: HTMLMediaElement): string | null => segmentedSources.get(element) || element.getAttribute('src');
export const setSegmentedAudioSource = (element: HTMLMediaElement, src: string | null): void => {
    if (src) segmentedSources.set(element, src);
    else segmentedSources.delete(element);
};
