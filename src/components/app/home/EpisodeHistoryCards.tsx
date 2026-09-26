import { Loader2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EpisodeHistoryAlbum } from '../../../utils/episodeHistory';
import { formatTime } from '../../../utils/appPlaybackHelpers';
import { DiscoveryCover } from './DiscoverySections';

// 每部剧呈现最近收听的一集；进度、续播按钮与分集侧栏共用原始记录。
export function EpisodeHistoryCard({ group, timestamp, busy, selected, onResume, onOpen, onEpisodes }: {
    group: EpisodeHistoryAlbum; timestamp: string; busy: string | null; selected: boolean;
    onResume: () => void; onOpen: () => void; onEpisodes: (trigger: HTMLButtonElement) => void;
}) {
    const { t } = useTranslation();
    const { song, progress, key } = group.latest;
    const label = progress.completed ? t('episodeHistory.completed') : t('episodes.position', { time: formatTime(progress.position) });
    const percentage = Math.min(100, progress.position / progress.duration * 100);
    return <article data-history-album={group.album.id} className="flex min-w-0 gap-4 border-b border-current/10 pb-5">
        <button type="button" onClick={onOpen} aria-label={t('episodeHistory.openAlbum', { name: group.album.name })}
            className="self-start rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            <DiscoveryCover url={group.album.coverUrl} className="aspect-[3/4] w-22 sm:w-26" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
            <button type="button" onClick={onOpen} className="line-clamp-2 self-start rounded text-left text-sm font-semibold leading-5 focus-visible:outline focus-visible:outline-2">{group.album.name}</button>
            <p className="mt-1.5 truncate text-xs leading-5 opacity-75">{song.name} · <span data-history-position>{label}</span></p>
            <time dateTime={new Date(group.latest.time).toISOString()} className="mt-1 text-xs tabular-nums opacity-70">{timestamp}</time>
            <div role="progressbar" aria-label={t('episodeHistory.progressFor', { name: song.name })} aria-valuenow={Math.round(percentage)}
                aria-valuemin={0} aria-valuemax={100} aria-valuetext={label} className="mt-2.5 h-0.5 overflow-hidden rounded-full bg-current/10">
                <div className="h-full bg-current opacity-70" style={{ width: `${percentage}%` }} />
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
                <button type="button" data-history-resume={song.id} onClick={onResume} disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-current/5 px-3 py-1.5 text-xs hover:bg-current/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
                    {busy === key ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                    {progress.completed ? t('episodeHistory.replay') : t('discovery.continueListening')}
                </button>
                <button type="button" data-history-episodes={group.album.id} aria-expanded={selected} onClick={event => onEpisodes(event.currentTarget)}
                    className="rounded py-1.5 text-xs opacity-75 hover:opacity-100 focus-visible:outline focus-visible:outline-2">{t('episodeHistory.episodes')}</button>
            </div>
        </div>
    </article>;
}
