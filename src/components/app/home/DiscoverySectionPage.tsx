import { AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { OmniCollection, OmniPage } from '../../../types/onlineMusic';
import { DiscoveryCover, DiscoveryPlayCount } from './DiscoverySections';
import { useDragToScroll } from '../../../hooks/useDragToScroll';

// 栏目详情使用双列紧凑列表，窄窗口回到单列；分页与专辑导航仍交给 Omni。
export default function DiscoverySectionPage({ title, page, loading, error, onBack, onOpen, onLoadMore }: {
    title: string; page: OmniPage<OmniCollection>; loading: boolean; error: boolean;
    onBack: () => void; onOpen: (album: OmniCollection) => void; onLoadMore: () => void;
}) {
    const { t, i18n } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollDrag = useDragToScroll(scrollRef, { axis: 'y', momentum: true });
    return <section data-testid="discovery-section-page" aria-label={title} className="flex min-h-0 w-full flex-1 flex-col">
        <header className="mx-auto grid w-full max-w-5xl shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-6 pb-4 lg:px-10">
            <button type="button" onClick={onBack} autoFocus data-testid="discovery-section-back" aria-label={t('discovery.backToHome')}
                className="-ml-2 flex w-fit items-center gap-1 rounded-lg px-2 py-2 text-sm hover:bg-current/5 focus-visible:outline focus-visible:outline-2">
                <ChevronLeft size={20} aria-hidden="true" /><span className="hidden sm:inline">{t('discovery.backToHome')}</span>
            </button>
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className="justify-self-end text-xs tabular-nums opacity-70">{page.total !== undefined && t('discovery.albumCount', { count: page.total })}</span>
        </header>
        <div ref={scrollRef} {...scrollDrag.handlers} data-testid="discovery-section-scroll"
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain select-none hide-scrollbar ${scrollDrag.isDragging ? 'cursor-grabbing [&_*]:cursor-grabbing' : 'cursor-default'}`}>
            <div className="mx-auto max-w-5xl px-6 pb-36 lg:px-10">
                <ul className="grid grid-cols-1 gap-x-7 md:grid-cols-2">{page.items.map(album => {
                    const count = album.playCount;
                    const playCountLabel = count === undefined ? t('episodes.playCountUnknown')
                        : t('episodes.playCount', { value: count.toLocaleString(i18n.resolvedLanguage || i18n.language) });
                    const updateLabel = album.latestEpisodeName ? t('discovery.updatedTo', { name: album.latestEpisodeName }) : undefined;
                    const description = album.description?.trim().split(/\r?\n\s*\r?\n|\u2029/, 1)[0]?.trim();
                    return <li key={`${album.providerId}:${album.id}`} className="min-w-0 border-b border-current/10">
                        <button type="button" data-discovery-list-album={album.id} onClick={() => onOpen(album)} aria-label={album.name}
                            aria-description={[playCountLabel, updateLabel, album.promotionLabel].filter(Boolean).join(' · ')}
                            className="flex h-full w-full min-w-0 gap-3.5 rounded-lg py-3 text-left hover:bg-current/5 focus-visible:outline focus-visible:outline-2">
                            <DiscoveryCover url={album.posterUrl || album.coverUrl} promotionLabel={album.promotionLabel} className="aspect-[3/4] w-[7.2rem] self-start">
                                <DiscoveryPlayCount count={count} />
                            </DiscoveryCover>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="block truncate text-sm font-medium leading-5">{album.name}</span>
                                {description && <span data-album-description className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-5 opacity-75">{description}</span>}
                                {updateLabel && <span data-album-update className="mt-auto block truncate pt-2 text-xs leading-4 opacity-70">{updateLabel}</span>}
                            </span>
                        </button>
                    </li>;
                })}</ul>
                {loading && <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm opacity-75"><Loader2 size={18} className="animate-spin" />{t('discovery.loading')}</p>}
                {error && <div role="alert" className="flex flex-wrap items-center justify-center gap-3 py-8 text-sm"><AlertCircle size={18} />{t('discovery.loadFailed')}
                    <button type="button" onClick={onLoadMore} className="rounded-lg px-3 py-2 hover:bg-current/5 focus-visible:outline focus-visible:outline-2">{t('search.retry')}</button></div>}
                {!loading && !error && !page.items.length && <p className="py-12 text-center text-sm opacity-70">{t('discovery.empty')}</p>}
                {!loading && !error && page.hasMore && <div className="flex justify-center py-6"><button type="button" onClick={onLoadMore}
                    className="rounded-lg px-4 py-2 text-sm hover:bg-current/5 focus-visible:outline focus-visible:outline-2">{t('discovery.loadMore')}</button></div>}
            </div>
        </div>
    </section>;
}
