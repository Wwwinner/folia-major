import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { useEpisodePlaybackStore } from '../../../stores/useEpisodePlaybackStore';
import { getEpisodeKey } from '../../../utils/episodePlayback';
import { formatTime } from '../../../utils/appPlaybackHelpers';
import { getEpisodeHistoryTime } from '../../../utils/episodeHistory';

// 专辑中的继续收听入口；正片跳转偏好由播放底栏控制，目录和历史记录保持完整。
export default function EpisodeCollectionControls({ tracks, onPlay }: {
    tracks: SongResult[]; onPlay: (song: SongResult) => void;
}) {
    const { t } = useTranslation();
    const progress = useEpisodePlaybackStore(state => state.progress);
    const latest = tracks.filter(song => progress[getEpisodeKey(song) || '']?.position > 0 && !progress[getEpisodeKey(song) || '']?.completed)
        .sort((a, b) => getEpisodeHistoryTime(progress[getEpisodeKey(b)!]) - getEpisodeHistoryTime(progress[getEpisodeKey(a)!]))[0];
    if (!latest) return null;
    return <div className="flex min-w-0 flex-col gap-2" data-testid="episode-collection-controls">
        <button type="button" onClick={() => onPlay(latest)}
            className="rounded-lg border border-current/20 px-3 py-2 text-left text-xs hover:bg-current/5 focus-visible:outline focus-visible:outline-2">
            <span className="block font-medium">{t('episodes.continue', { time: formatTime(progress[getEpisodeKey(latest)!].position) })}</span>
            <span className="mt-1 block truncate opacity-75">{latest.name}</span>
        </button>
    </div>;
}
