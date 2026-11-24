import Hls from 'hls.js';
import type { FoliumClientApi, FoliumSourceExternalPlayback, FoliumSourceSong } from '@folia/folium';
import type { FanjiaoRequest } from '../contracts';
import type { FanjiaoHistory } from './history';

// HLS 只读取模组短期媒体地址；Folia 通过 external 路由驱动同一个音轨及播放时钟。
interface Session {
    song: FoliumSourceSong;
    audio: HTMLAudioElement;
    events: AbortController;
    token?: string;
    hls?: Hls;
    wantsPlay: boolean;
    waiting: boolean;
    played: boolean;
    lastSave: number;
    failure?: Error;
    positionAfterFailure?: number;
}

export function createFanjiaoPlayer(
    folium: FoliumClientApi,
    request: FanjiaoRequest,
    history: FanjiaoHistory,
) {
    let session: Session | undefined;
    let volume = 1;
    const durationOf = (current: Session) => Number.isFinite(current.audio.duration)
        ? current.audio.duration : (current.song.durationMs ?? 0) / 1000;
    const checkpoint = (current: Session) => {
        if (current.played && !current.failure) {
            current.lastSave = Date.now();
            history.record(current.song, current.audio.currentTime, durationOf(current), current.audio.ended);
        }
    };
    const close = (token: string) => {
        void request('closeAudio', { token }).catch((error: unknown) => folium.log.warn('[Fanjiao] Could not close media session', error));
    };
    const releaseMedia = (current: Session) => {
        if (current.events.signal.aborted) return;
        current.events.abort();
        current.audio.pause();
        current.hls?.destroy();
        current.audio.removeAttribute('src');
        current.audio.load();
        if (current.token) close(current.token);
        current.token = undefined;
        current.hls = undefined;
    };
    const dispose = () => {
        const current = session;
        if (!current) return;
        session = undefined;
        checkpoint(current);
        releaseMedia(current);
    };
    const playbackFailure = () => folium.sources.error('network', folium.i18n.text('playbackFailed'));
    const begin = async (current: Session) => {
        if (!current.wantsPlay || !current.token || !current.audio.paused) return;
        current.waiting = true;
        await current.audio.play().catch(() => {
            if (session === current && current.wantsPlay) throw current.failure ?? playbackFailure();
        });
    };
    const player = {
        dispose,
        async play(song, startSec) {
            dispose();
            if (!Hls.isSupported()) throw folium.sources.error('unavailable', folium.i18n.text('unsupportedPlayback'));
            const audio = new Audio();
            audio.volume = volume;
            const events = new AbortController();
            const options = { signal: events.signal };
            const current: Session = { song, audio, events, wantsPlay: true, waiting: true, played: false, lastSave: 0 };
            session = current;
            function fail(error: Error) {
                if (session !== current || current.failure) return;
                checkpoint(current);
                current.positionAfterFailure = current.played ? audio.currentTime : startSec;
                current.failure = error;
                releaseMedia(current);
            }
            audio.addEventListener('playing', () => {
                current.played = true;
                current.waiting = false;
            }, options);
            audio.addEventListener('waiting', () => { current.waiting = true; }, options);
            audio.addEventListener('timeupdate', () => {
                if (!audio.paused && Date.now() - current.lastSave >= 5000) checkpoint(current);
            }, options);
            audio.addEventListener('seeked', () => checkpoint(current), options);
            audio.addEventListener('ended', () => checkpoint(current), options);
            audio.addEventListener('error', () => fail(playbackFailure()), options);
            try {
                const source = await request('audioSource', { id: song.id });
                if (session !== current) {
                    close(source.token);
                    return;
                }
                current.token = source.token;
                const hls = new Hls({
                    enableWorker: false,
                    startPosition: startSec,
                    maxBufferLength: 60,
                    maxMaxBufferLength: 120,
                    fragLoadPolicy: { default: {
                        maxTimeToFirstByteMs: 65_000, maxLoadTimeMs: 65_000, timeoutRetry: null, errorRetry: null,
                    } },
                });
                current.hls = hls;
                hls.on(Hls.Events.ERROR, (_event, detail) => {
                    if (detail.fatal) fail(playbackFailure());
                });
                hls.loadSource(source.url);
                hls.attachMedia(audio);
                await begin(current);
                if (current.failure) throw current.failure;
            } catch (error) {
                if (session !== current) return;
                fail(error instanceof Error ? error : playbackFailure());
                throw error;
            }
        },
        pause() {
            if (session) {
                session.wantsPlay = false;
                session.audio.pause();
                checkpoint(session);
            }
            return Promise.resolve();
        },
        async resume() {
            const current = session;
            if (!current || !current.audio.paused) return;
            current.wantsPlay = true;
            if (!current.token) {
                if (current.positionAfterFailure !== undefined) await player.play(current.song, current.positionAfterFailure);
                return;
            }
            const stillResuming = () => session === current && current.wantsPlay;
            const alive = await request('hasAudio', { token: current.token });
            if (!stillResuming()) return;
            if (!alive || current.failure) {
                await player.play(current.song, current.positionAfterFailure ?? current.audio.currentTime);
                return;
            }
            await begin(current);
        },
        seek(seconds) {
            if (session) {
                const duration = durationOf(session);
                const position = duration > 0 ? Math.min(seconds, duration) : seconds;
                if (session.failure) session.positionAfterFailure = position;
                if (!session.failure) session.audio.currentTime = position;
            }
            return Promise.resolve();
        },
        setVolume(level) {
            volume = level;
            if (session) session.audio.volume = level;
            return Promise.resolve();
        },
        getStatus() {
            if (!session) return Promise.resolve({ mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false });
            if (session.failure) return Promise.reject(session.failure);
            const { audio, song, waiting, wantsPlay } = session;
            return Promise.resolve({
                mediaId: song.id,
                isPlaying: !audio.paused && !audio.ended && !waiting,
                positionMs: audio.currentTime * 1000,
                durationMs: durationOf(session) * 1000,
                ended: audio.ended,
                seeking: audio.seeking,
                starting: wantsPlay && waiting && !audio.ended,
            });
        },
        isStatusForSong: (song, status) => song.id === status.mediaId,
    } satisfies FoliumSourceExternalPlayback & { dispose: () => void };
    return player;
}
