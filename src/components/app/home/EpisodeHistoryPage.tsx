import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, History, Loader2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { OmniCollection } from '../../../types/onlineMusic';
import { episodeHistoryDay } from '../../../utils/episodeHistory';
import { formatTime } from '../../../utils/appPlaybackHelpers';
import { useDragToScroll } from '../../../hooks/useDragToScroll';
import { useEpisodeResume } from '../../../hooks/useEpisodeResume';
import { SidePanelList } from '../../shared/SidePanelList';
import { useEpisodeHistory } from './useEpisodeHistory';
import { EpisodeHistoryCard } from './EpisodeHistoryCards';

// 历史作为独立首页入口，侧栏仅展示听过的分集，点播仍使用完整专辑队列。
export default function EpisodeHistoryPage({ providerId, isDaylight, onPlay, onOpen }: {
    providerId: string; isDaylight: boolean; onPlay: (song: SongResult, queue: SongResult[]) => void; onOpen: (album: OmniCollection) => void;
}) {
    const { t, i18n } = useTranslation();
    const history = useEpisodeHistory(providerId);
    const playback = useEpisodeResume(providerId, onPlay);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [today, setToday] = useState(Date.now);
    const selected = history.allGroups.find(group => group.key === selectedKey);
    const scrollRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const returnFocus = useRef<HTMLButtonElement | null>(null);
    const drag = useDragToScroll(scrollRef, { axis: 'y', momentum: true });
    const buttonClass = 'rounded-lg px-3 py-2 text-sm hover:bg-current/5 focus-visible:outline focus-visible:outline-2';
    const formats = useMemo(() => ({
        time: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { timeStyle: 'short' }),
        date: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { dateStyle: 'short', timeStyle: 'short' }),
    }), [i18n.resolvedLanguage, i18n.language]);
    const timestamp = (time: number) => (episodeHistoryDay(time, today) === 'earlier' ? formats.date : formats.time).format(time);
    const closePanel = () => { setSelectedKey(null); returnFocus.current?.focus({ preventScroll: true }); };
    useEffect(() => {
        const next = new Date(); next.setHours(24, 0, 0, 0);
        const timer = setTimeout(() => setToday(Date.now()), next.getTime() - Date.now() + 100);
        return () => clearTimeout(timer);
    }, [today]);
    useEffect(() => { void history.hydrateAlbum(selected?.album || null); }, [selected?.key, history.hydrateAlbum]);
    useEffect(() => {
        if (!selectedKey) return;
        const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[data-panel-close]')?.focus({ preventScroll: true }));
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault(); event.stopPropagation();
            setSelectedKey(null); returnFocus.current?.focus({ preventScroll: true });
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown, true); };
    }, [selectedKey]);
    return <section data-testid="episode-history-page" aria-label={t('episodeHistory.title')} className="relative flex min-h-0 w-full flex-1 flex-col" style={{ color: 'var(--text-primary)' }}>
        <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between gap-3 px-6 pb-5 lg:px-10">
            <h2 className="text-lg font-semibold">{t('episodeHistory.title')}</h2>
            <span className="text-xs opacity-65">{t('episodeHistory.count', { count: history.total })}</span>
        </header>
        <div ref={scrollRef} {...drag.handlers} data-testid="episode-history-scroll"
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain select-none hide-scrollbar ${drag.isDragging ? 'cursor-grabbing [&_*]:cursor-grabbing' : 'cursor-grab'}`}>
            <div className="mx-auto max-w-7xl px-6 pb-36 lg:px-10">
                {(['today', 'yesterday', 'earlier'] as const).map(day => {
                    const groups = history.groups.filter(group => episodeHistoryDay(group.latest.time, today) === day);
                    return groups.length > 0 && <section key={day} aria-label={t(`episodeHistory.${day}`)} className="mb-7">
                        <h3 className="mb-4 text-xs font-medium opacity-70">{t(`episodeHistory.${day}`)}</h3>
                        <div className="grid grid-cols-1 gap-x-7 gap-y-6 md:grid-cols-2">{groups.map(group => <EpisodeHistoryCard key={group.key}
                            group={group} timestamp={timestamp(group.latest.time)} busy={playback.busy} selected={group.key === selectedKey}
                            onResume={() => void playback.resume(group.latest.song)} onOpen={() => { setSelectedKey(null); onOpen(group.album); }}
                            onEpisodes={trigger => { drag.cancelDrag(); returnFocus.current = trigger; setSelectedKey(group.key); }} />)}</div>
                    </section>;
                })}
                {history.loading && <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm opacity-75"><Loader2 size={16} className="animate-spin" />{t('episodeHistory.loading')}</p>}
                {history.failed && <div role="alert" className="flex flex-wrap items-center justify-center gap-2 py-5 text-sm"><AlertCircle size={16} />{t('episodeHistory.loadFailed')}
                    <button type="button" onClick={history.retry} className={buttonClass}>{t('search.retry')}</button></div>}
                {playback.playFailed && <p role="alert" className="py-4 text-center text-sm">{t('discovery.resumeFailed')}</p>}
                {!history.total && !history.loading && <div className="flex flex-col items-center gap-3 py-20 text-sm opacity-70"><History size={30} aria-hidden="true" /><p>{t('episodeHistory.empty')}</p></div>}
                {history.hasMore && <div className="flex justify-center py-4"><button type="button" onClick={history.loadMore} disabled={history.loading}
                    className={`${buttonClass} disabled:opacity-50`}>{t('episodeHistory.loadMore')}</button></div>}
            </div>
        </div>
        <div ref={panelRef} data-testid="history-episode-panel">
            <SidePanelList isOpen={Boolean(selected)} onClose={closePanel} title={selected?.album.name || t('episodeHistory.episodes')}
                items={selected?.episodes || []} itemHeight={84} isDaylight={isDaylight} className="top-14!"
                headerLeadingActions={<div className="mb-1 text-xs opacity-70">{history.panelLoading ? t('episodeHistory.loading') : t('episodeHistory.episodes')}
                    {history.panelFailed && <button type="button" className="ml-2 underline" onClick={() => void history.hydrateAlbum(selected?.album || null)}>{t('search.retry')}</button>}</div>}
                renderItem={(record, _index, style) => <button type="button" style={style} data-history-episode={record.song.id} disabled={Boolean(playback.busy)}
                    onClick={() => void playback.resume(record.song)} className="flex h-full w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-current/5 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{record.song.name}</span>
                        <span className="mt-1 block text-xs opacity-70">{record.progress.completed ? t('episodeHistory.completed') : t('episodes.position', { time: formatTime(record.progress.position) })}</span>
                        <time dateTime={new Date(record.time).toISOString()} className="mt-1 block text-xs opacity-60">{timestamp(record.time)}</time></span>
                    {playback.busy === record.key ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} aria-hidden="true" />}
                </button>} />
        </div>
    </section>;
}
