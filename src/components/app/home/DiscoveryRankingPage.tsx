import { useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HomeDiscoverySection, OmniCollection, OmniPage } from '../../../types/onlineMusic';
import { useDragToScroll } from '../../../hooks/useDragToScroll';
import { DiscoveryRankingHighlight, DiscoveryRankingList, DiscoveryRankingTabs, DiscoveryRankingTransition } from './DiscoveryRankings';

// 完整榜单复用栏目分页；总榜仅显示占位，不使用月榜数据，也不发出未核验的请求。
export default function DiscoveryRankingPage({ sections, section, page, loading, error, onSelect, onBack, onOpen, onLoadMore }: {
    sections: HomeDiscoverySection[]; section: HomeDiscoverySection; page: OmniPage<OmniCollection>;
    loading: boolean; error: boolean; onSelect: (section: HomeDiscoverySection) => void;
    onBack: () => void; onOpen: (album: OmniCollection) => void; onLoadMore: () => void;
}) {
    const { t } = useTranslation();
    const [totalPlaceholder, setTotalPlaceholder] = useState(false);
    const [direction, setDirection] = useState(1);
    const periodLayoutId = useId();
    const placeholder = section.moreId === 'ranking-feeding' && totalPlaceholder;
    const scrollRef = useRef<HTMLDivElement>(null);
    const drag = useDragToScroll(scrollRef, { axis: 'y', momentum: true });
    const buttonClass = 'rounded-lg px-3 py-2 text-sm hover:bg-current/5 focus-visible:outline focus-visible:outline-2';
    useLayoutEffect(() => {
        drag.cancelDrag();
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [section.moreId, placeholder, drag.cancelDrag]);
    return <section data-testid="discovery-ranking-page" aria-label={t('discovery.rankings')} className="flex min-h-0 w-full flex-1 flex-col">
        <header className="mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-5 px-6 pb-4 lg:px-10">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <button type="button" autoFocus data-testid="discovery-ranking-back" onClick={onBack} aria-label={t('discovery.backToHome')}
                    className={`${buttonClass} -ml-2 flex w-fit items-center gap-1 px-2`}>
                    <ChevronLeft size={20} aria-hidden="true" /><span className="hidden sm:inline">{t('discovery.backToHome')}</span>
                </button>
                <h2 className="text-lg font-semibold">{t('discovery.rankings')}</h2>
                <span className="justify-self-end text-xs tabular-nums opacity-70">{!placeholder && page.total !== undefined && t('discovery.albumCount', { count: page.total })}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
                <div><DiscoveryRankingTabs sections={sections} selectedId={section.moreId} onSelect={next => {
                    setDirection(sections.indexOf(next) >= sections.indexOf(section) ? 1 : -1);
                    setTotalPlaceholder(false); onSelect(next);
                }} /></div>
                {section.moreId === 'ranking-feeding' && <div role="group" aria-label={t('discovery.rankingPeriod')} className="flex w-fit gap-1 rounded-full bg-current/5 p-0.5">
                    {(['month', 'total'] as const).map(period => {
                        const selected = period === 'total' ? placeholder : !placeholder;
                        return <button key={period} type="button" data-ranking-period={period}
                            aria-pressed={selected} onClick={() => { setDirection(period === 'total' ? 1 : -1); setTotalPlaceholder(period === 'total'); }}
                            className="relative rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 hover:bg-current/5">
                            {selected && <DiscoveryRankingHighlight layoutId={periodLayoutId} />}
                            <span className={`relative ${selected ? '' : 'opacity-65'}`}>{t(period === 'total' ? 'discovery.totalRanking' : 'discovery.monthlyRanking')}</span>
                        </button>;
                    })}
                </div>}
            </div>
        </header>
        <div ref={scrollRef} {...drag.handlers} data-testid="discovery-ranking-scroll"
            className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain select-none hide-scrollbar ${drag.isDragging ? 'cursor-grabbing [&_*]:cursor-grabbing' : 'cursor-default'}`}>
            <div className="mx-auto max-w-5xl px-6 pb-36 lg:px-10">
                <DiscoveryRankingTransition direction={direction} transitionKey={`${section.moreId}:${placeholder ? 'total' : page.items.length ? 'content' : error ? 'error' : loading ? 'loading' : 'empty'}`}>
                {placeholder ? <div data-testid="ranking-total-placeholder" role="status" className="py-16 text-center">
                    <p className="text-base font-medium">{t('discovery.rankingTotalUnavailable')}</p>
                    <p className="mt-2 text-sm opacity-70">{t('discovery.rankingTotalHint')}</p>
                    <button type="button" className={`${buttonClass} mt-4`} onClick={() => { setDirection(-1); setTotalPlaceholder(false); }}>{t('discovery.viewMonthlyRanking')}</button>
                </div> : <>
                    <DiscoveryRankingList items={page.items} onOpen={onOpen} />
                    {loading && <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm opacity-75"><Loader2 size={18} className="animate-spin" />{t('discovery.loading')}</p>}
                    {error && <div role="alert" className="flex flex-wrap items-center justify-center gap-3 py-8 text-sm"><AlertCircle size={18} />{t('discovery.loadFailed')}
                        <button type="button" onClick={onLoadMore} className={buttonClass}>{t('search.retry')}</button></div>}
                    {!loading && !error && !page.items.length && <p className="py-12 text-center text-sm opacity-70">{t('discovery.empty')}</p>}
                    {!loading && !error && page.hasMore && <div className="flex justify-center py-6"><button type="button" onClick={onLoadMore} className={buttonClass}>{t('discovery.loadMore')}</button></div>}
                </>}
                </DiscoveryRankingTransition>
            </div>
        </div>
    </section>;
}
