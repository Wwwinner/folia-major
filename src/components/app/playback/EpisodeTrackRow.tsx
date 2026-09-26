import type { CSSProperties } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { getEpisodeKey } from '../../../utils/episodePlayback';
import { formatTime } from '../../../utils/appPlaybackHelpers';
import { useEpisodePlaybackStore } from '../../../stores/useEpisodePlaybackStore';

// 单双列共用相同行高和内容间距；播放信息优先同行，窄格内换行，不预留空白行。
export default function EpisodeTrackRow({ track, style, onPlay, active }: {
    track: SongResult; style: CSSProperties; onPlay: () => void; active: boolean;
}) {
    const { t, i18n } = useTranslation();
    const key = getEpisodeKey(track);
    const progress = useEpisodePlaybackStore(state => key ? state.progress[key] : undefined);
    const playCount = track.episode?.playCount;
    const locale = i18n.resolvedLanguage || i18n.language;
    const playCountLabel = playCount === undefined ? '—'
        : playCount >= 10000 ? `${Number((playCount / 10000).toFixed(1))}w`
        : playCount >= 1000 ? `${Number((playCount / 1000).toFixed(1))}k` : String(playCount);
    const exactPlayCount = playCount === undefined ? t('episodes.playCountUnknown')
        : t('episodes.playCount', { value: playCount.toLocaleString(locale) });
    return <div style={style} className="px-1 py-1" data-episode-id={track.sourceRef?.mediaId}>
        <div className={`flex h-full min-w-0 items-center gap-1 rounded-lg ${active ? 'bg-current/10' : ''}`}>
            <button type="button" onClick={onPlay} className="flex h-full min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1 text-left hover:bg-current/5 focus-visible:outline focus-visible:outline-2">
                <span className="block truncate text-sm font-medium">{track.name}</span>
                <span className="mt-1 flex min-w-0 flex-wrap content-start items-center gap-x-3 gap-y-1 text-xs tabular-nums opacity-75">
                    <span className="inline-flex shrink-0 items-center gap-1" aria-label={exactPlayCount}>
                        <Play size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />{playCountLabel}
                    </span>
                    {progress && <span className="max-w-full truncate">{t('episodes.position', { time: formatTime(progress.position) })}</span>}
                </span>
            </button>
            {progress && <button type="button" title={t('episodes.restart')} aria-label={t('episodes.restart')}
                onClick={() => { useEpisodePlaybackStore.getState().restartEpisode(track); onPlay(); }}
                className="rounded-full p-2 hover:bg-current/10 focus-visible:outline focus-visible:outline-2"><RotateCcw size={15} /></button>}
        </div>
    </div>;
}
