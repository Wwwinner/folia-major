import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult, Theme } from '../../../types';
import type { HomeDiscoverySection, OmniCollection } from '../../../types/onlineMusic';
import { CustomSelect } from '../../shared/CustomSelect';
import { formatTime } from '../../../utils/appPlaybackHelpers';
import { useDiscoveryHome, type DiscoveryView } from './useDiscoveryHome';
import { useEpisodeContinueListening } from './useEpisodeContinueListening';
import { DiscoveryAlbumCard, DiscoveryAlbumSection, DiscoveryCover, discoveryGridClass } from './DiscoverySections';
import DiscoverySectionPage from './DiscoverySectionPage';
import DiscoveryRankingPage from './DiscoveryRankingPage';
import { DiscoveryRankingPreview } from './DiscoveryRankings';
import DiscoveryBannerCarousel from './DiscoveryBannerCarousel';
import { useDragToScroll } from '../../../hooks/useDragToScroll';

// 发现页采用 Folia 现有主题：导航与筛选在上，横幅和续听在推荐前部，栏目与榜单按官方数据展示。
export default function OnlineDiscoveryHome({ providerId, theme, isDaylight, onOpen, onPlay }: {
    providerId: string; theme: Theme; isDaylight: boolean;
    onOpen: (album: OmniCollection) => void; onPlay: (song: SongResult, queue: SongResult[]) => void;
}) {
    const { t } = useTranslation();
    const [view, setView] = useState<DiscoveryView>('recommendations');
    const [moreSection, setMoreSection] = useState<HomeDiscoverySection | null>(null);
    const [activeRankingId, setActiveRankingId] = useState('ranking-feeding');
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollDrag = useDragToScroll(contentRef, { axis: 'y', momentum: true });
    const previousScroll = useRef(0);
    const previousFocus = useRef<HTMLElement | null>(null);
    const data = useDiscoveryHome(providerId, view, moreSection?.moreId);
    const recent = useEpisodeContinueListening(providerId, onPlay);
    const rankings = data.home.items.filter(section => section.kind === 'ranking' && section.moreId);
    const activeRanking = rankings.find(section => section.moreId === activeRankingId) || rankings[0];
    const albums = data.home.items.filter(section => section.kind === 'albums');
    const banners = data.home.items.find(section => section.kind === 'banners')?.banners || [];
    const loading = view === 'browse' ? data.browseLoading || (!data.filters.length && !data.filtersError) : data.homeLoading;
    const error = view === 'browse' ? data.browseError || data.filtersError : data.homeError;
    const empty = view === 'browse' ? !data.browse.items.length : !albums.length && !rankings.length && !banners.length;
    const retry = () => view === 'browse'
        ? (data.filtersError ? void data.loadFilters() : void data.loadBrowse(data.browse.items.length ? data.browse.nextOffset : 0))
        : void data.loadHome(data.home.items.length ? data.home.nextOffset : 0);
    const buttonClass = 'rounded-lg px-3 py-2 text-sm hover:bg-current/5 focus-visible:outline focus-visible:outline-2 disabled:opacity-50';
    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;
        let hideTimer: ReturnType<typeof setTimeout> | undefined;
        // 滚动期间仅切换离散属性；滑块位置、尺寸和淡入淡出由浏览器管理。
        const revealScrollbar = () => {
            if (!container.dataset.scrollbarScrolling) container.dataset.scrollbarScrolling = 'true';
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { delete container.dataset.scrollbarScrolling; }, 1000);
        };
        const clearProximity = () => {
            if (container.dataset.scrollbarNearby) delete container.dataset.scrollbarNearby;
        };
        const updateProximity = (event: PointerEvent) => {
            if (event.pointerType === 'touch') return;
            const distance = container.getBoundingClientRect().right - event.clientX;
            if (distance >= 0 && distance <= 28) {
                if (!container.dataset.scrollbarNearby) container.dataset.scrollbarNearby = 'true';
            } else clearProximity();
        };
        container.addEventListener('scroll', revealScrollbar, { passive: true });
        container.addEventListener('pointerenter', updateProximity, { passive: true });
        container.addEventListener('pointermove', updateProximity, { passive: true });
        container.addEventListener('pointerleave', clearProximity, { passive: true });
        return () => {
            container.removeEventListener('scroll', revealScrollbar);
            container.removeEventListener('pointerenter', updateProximity);
            container.removeEventListener('pointermove', updateProximity);
            container.removeEventListener('pointerleave', clearProximity);
            clearTimeout(hideTimer);
            delete container.dataset.scrollbarScrolling;
            clearProximity();
        };
    }, []);
    useLayoutEffect(() => {
        scrollDrag.cancelDrag();
        if (!moreSection && contentRef.current) {
            contentRef.current.scrollTop = previousScroll.current;
            previousFocus.current?.focus({ preventScroll: true });
        }
    }, [moreSection, scrollDrag.cancelDrag]);
    const openMore = (section: HomeDiscoverySection) => {
        previousScroll.current = contentRef.current?.scrollTop || 0;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (section.kind === 'ranking' && section.moreId) setActiveRankingId(section.moreId);
        setMoreSection(section);
    };

    return <div data-testid="online-discovery-home" className="flex min-h-0 w-full flex-1 flex-col" style={{ color: 'var(--text-primary)' }}>
        {moreSection && (moreSection.kind === 'ranking'
            ? <DiscoveryRankingPage sections={rankings} section={moreSection} page={data.sectionPage} loading={data.sectionLoading} error={data.sectionError}
                onSelect={section => { setActiveRankingId(section.moreId!); setMoreSection(section); }}
                onBack={() => setMoreSection(null)} onOpen={onOpen} onLoadMore={() => void data.loadSection(data.sectionPage.items.length ? data.sectionPage.nextOffset : 0)} />
            : <DiscoverySectionPage title={moreSection.title} page={data.sectionPage} loading={data.sectionLoading} error={data.sectionError}
                onBack={() => setMoreSection(null)} onOpen={onOpen} onLoadMore={() => void data.loadSection(data.sectionPage.items.length ? data.sectionPage.nextOffset : 0)} />)}
        <div className={moreSection ? 'hidden' : 'contents'}>
        <nav aria-label={t('discovery.navigation')} className="mx-auto flex w-full max-w-7xl shrink-0 items-center gap-1 px-6 pb-4 lg:px-10">
            {(['recommendations', 'browse', 'rankings'] as const).map(tab => <button key={tab} type="button"
                data-testid={`discovery-tab-${tab}`} aria-current={view === tab ? 'page' : undefined}
                disabled={tab === 'rankings' && !activeRanking}
                onClick={() => {
                    scrollDrag.cancelDrag();
                    if (tab === 'rankings') { if (activeRanking) openMore(activeRanking); }
                    else { setView(tab); contentRef.current?.scrollTo({ top: 0 }); }
                }}
                className={`${buttonClass} ${view === tab ? 'bg-current/10 font-semibold' : 'opacity-70'}`}>
                {t(`discovery.${tab}`)}
            </button>)}
        </nav>
        <div ref={contentRef} {...scrollDrag.handlers} data-testid="discovery-home-scroll"
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain select-none discovery-auto-scrollbar ${scrollDrag.isDragging ? 'cursor-grabbing [&_*]:cursor-grabbing' : 'cursor-default'}`}>
            <div className="mx-auto max-w-7xl space-y-9 px-6 pt-2 pb-36 lg:px-10">
                {view === 'recommendations' && banners.length > 0 && <DiscoveryBannerCarousel banners={banners} onOpen={onOpen} />}
                {view === 'recommendations' && (recent.items.length > 0 || recent.loading || recent.failed) && <section aria-label={t('discovery.continueListening')}>
                    <h2 className="mb-4 text-lg font-semibold">{t('discovery.continueListening')}</h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{recent.items.map(item => <button type="button" key={item.key}
                        data-continue-episode={item.song.id} disabled={Boolean(recent.busy)} onClick={() => void recent.resume(item.song)}
                        className="flex min-w-0 items-center gap-3 rounded-xl bg-current/5 p-3 text-left hover:bg-current/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-60">
                        <DiscoveryCover url={item.song.album.coverUrl} className="h-16 w-16" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.song.album.name}</span>
                            <span className="mt-1 block truncate text-xs opacity-75">{item.song.name}</span>
                            <span className="mt-1 block text-xs tabular-nums opacity-75">{t('episodes.position', { time: formatTime(item.position) })}</span></span>
                        {recent.busy === item.key ? <Loader2 size={18} className="shrink-0 animate-spin" /> : <Play size={18} className="shrink-0" aria-hidden="true" />}
                    </button>)}</div>
                    {recent.loading && !recent.items.length && <p className="text-sm opacity-70" role="status">{t('discovery.loading')}</p>}
                    {recent.failed && <button type="button" className={buttonClass} onClick={recent.retry}>{t('discovery.resumeUnavailable')} · {t('search.retry')}</button>}
                </section>}
                {recent.playFailed && <p role="alert" className="text-sm">{t('discovery.resumeFailed')}</p>}
                {view === 'browse' && data.filters.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {data.filters.map(filter => <div key={filter.key} className="min-w-0">
                        <span className="mb-2 block text-xs opacity-75">{t(`discovery.filters.${filter.key}`)}</span>
                        <CustomSelect value={data.query[filter.key] || ''} options={filter.options} ariaLabel={t(`discovery.filters.${filter.key}`)}
                            onChange={value => data.setQuery(previous => ({ ...previous, [filter.key]: value }))} theme={theme} isDaylight={isDaylight} />
                    </div>)}
                </div>}
                {loading && empty && <div role="status" aria-label={t('discovery.loading')} className={discoveryGridClass}>
                    {Array.from({ length: 6 }, (_, index) => <div key={index} className="motion-safe:animate-pulse">
                        <div className="aspect-square rounded-xl bg-current/5" /><div className="mt-3 h-4 w-3/4 rounded bg-current/5" />
                    </div>)}
                </div>}
                {view === 'recommendations' && albums.map(section => <DiscoveryAlbumSection key={section.id} section={section} onOpen={onOpen} onMore={openMore} />)}
                {view === 'recommendations' && rankings.length > 0 && <DiscoveryRankingPreview sections={rankings} selectedId={activeRankingId}
                    onSelect={section => setActiveRankingId(section.moreId!)} onMore={openMore} onOpen={onOpen} />}
                {view === 'browse' && <div className={discoveryGridClass}>{data.browse.items.map(album => <DiscoveryAlbumCard key={`${album.providerId}:${album.id}`} album={album} onOpen={onOpen} />)}</div>}
                {error && <div role="alert" className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm"><AlertCircle size={18} />{t('discovery.loadFailed')}
                    <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} onClick={retry}><RotateCcw size={14} />{t('search.retry')}</button></div>}
                {!error && !loading && empty && <p className="py-12 text-center text-sm opacity-70">{t('discovery.empty')}</p>}
                {!error && (view === 'browse' ? data.browse.hasMore : data.home.hasMore) && <div className="flex justify-center">
                    <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} disabled={loading}
                        onClick={() => view === 'browse' ? void data.loadBrowse(data.browse.nextOffset) : void data.loadHome(data.home.nextOffset)}>
                        {loading && <Loader2 size={16} className="animate-spin" />}{t('discovery.loadMore')}
                    </button></div>}
            </div>
        </div>
        </div>
    </div>;
}
