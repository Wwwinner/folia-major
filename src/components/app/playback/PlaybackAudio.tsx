import { forwardRef, useCallback, useLayoutEffect, useRef, type AudioHTMLAttributes } from 'react';
import Hls, { FetchLoader } from 'hls.js';
import { isSegmentedAudioSource, setSegmentedAudioSource } from '../../../services/playbackMediaSource';
import type { SongResult } from '../../../types';
import { getEpisodeKey } from '../../../utils/episodePlayback';
import { createEpisodeProgressRecorder } from '../../../services/episodeProgressRecorder';
import { useEpisodePlaybackStore } from '../../../stores/useEpisodePlaybackStore';

// 每个正式音轨拥有自己的 HLS 实例，切换来源和卸载时一并释放 MSE 与网络请求。
const PlaybackAudio = forwardRef<HTMLAudioElement, AudioHTMLAttributes<HTMLAudioElement> & { episodeSong?: SongResult | null }>(({ src, episodeSong, ...props }, ref) => {
    const elementRef = useRef<HTMLAudioElement | null>(null);
    const attach = useCallback((element: HTMLAudioElement | null) => {
        elementRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
    }, [ref]);
    const episodeKey = getEpisodeKey(episodeSong);
    // 先清理进度记录器，再销毁 HLS；不能用销毁后归零的媒体时间覆盖旧集。
    useLayoutEffect(() => {
        if (!elementRef.current || !episodeSong || !episodeKey || !src) return;
        return createEpisodeProgressRecorder(elementRef.current, episodeSong, src,
            useEpisodePlaybackStore.getState().saveProgress);
    }, [episodeKey, src]);
    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!element) return;
        if (!src || !isSegmentedAudioSource(src)) {
            // React 先提交 src，旧 HLS 的 layout cleanup 随后会移除它；切回文件源时恢复该提交。
            if (src && element.getAttribute('src') !== src) element.setAttribute('src', src);
            return;
        }
        setSegmentedAudioSource(element, src);
        if (!Hls.isSupported()) {
            element.dispatchEvent(new Event('error'));
            return () => setSegmentedAudioSource(element, null);
        }
        const hls = new Hls({ loader: FetchLoader, backBufferLength: 30, maxBufferLength: 30,
            maxMaxBufferLength: 60, maxBufferSize: 8 * 1024 * 1024 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            console.warn('[HLS] Playback failed', data.type, data.details, data.response?.code);
            hls.stopLoad();
            element.dispatchEvent(new Event('error'));
        });
        hls.attachMedia(element);
        hls.loadSource(src);
        return () => {
            hls.destroy();
            setSegmentedAudioSource(element, null);
        };
    }, [src]);
    return <audio {...props} ref={attach} src={isSegmentedAudioSource(src) ? undefined : src} />;
});
PlaybackAudio.displayName = 'PlaybackAudio';
export default PlaybackAudio;
