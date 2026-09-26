import { ChevronRight, Flame, Heart, Play, Soup } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { HomeDiscoverySection, OmniCollection } from '../../../types/onlineMusic';
import { HorizontalScrollRow } from '../../shared/HorizontalScrollRow';
import { DiscoveryCover, formatDiscoveryCount } from './DiscoverySections';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';

// 首页领奖台与完整榜单复用标签和切换动效，名次及指标始终来自官方接口。
const METRIC_ICONS = { feeding: Soup, followers: Heart, popularity: Flame, plays: Play };
const SWITCH_EASE = [0.22, 1, 0.36, 1] as const;

export function DiscoveryRankingHighlight({ layoutId }: { layoutId: string }) {
    const reduced = useReducedMotionFor('uiMicroMotion');
    return <motion.span layoutId={layoutId} aria-hidden="true" data-ranking-highlight
        className="pointer-events-none absolute inset-0 rounded-full bg-current/10"
        transition={{ duration: reduced ? 0 : 0.28, ease: SWITCH_EASE }} />;
}

// 只在切榜或首批内容到达时播放一次；翻页不重播，连续时间由 Motion 管理。
export function DiscoveryRankingTransition({ transitionKey, direction, children }: {
    transitionKey: string; direction: number; children: ReactNode;
}) {
    const reduced = useReducedMotionFor('uiMicroMotion');
    return <motion.div key={transitionKey} data-ranking-transition className="min-w-0"
        initial={reduced ? false : { opacity: 0.45, x: direction * 18 }} animate={{ opacity: 1, x: 0 }}
        transition={{ duration: reduced ? 0 : 0.24, ease: SWITCH_EASE }}>{children}</motion.div>;
}

export function DiscoveryRankingTabs({ sections, selectedId, onSelect }: {
    sections: HomeDiscoverySection[]; selectedId?: string; onSelect: (section: HomeDiscoverySection) => void;
}) {
    const { t } = useTranslation();
    const layoutId = useId();
    return <HorizontalScrollRow label={t('discovery.rankingCategories')} className="auto-cols-max gap-2!">
        {sections.map(section => <button key={section.id} type="button" data-ranking-tab={section.moreId}
            aria-pressed={selectedId === section.moreId} onClick={() => onSelect(section)}
            className="relative whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 hover:bg-current/5">
            {selectedId === section.moreId && <DiscoveryRankingHighlight layoutId={layoutId} />}
            <span className={`relative ${selectedId === section.moreId ? '' : 'opacity-65'}`}>{section.title}</span>
        </button>)}
    </HorizontalScrollRow>;
}

export function DiscoveryRankingList({ items, onOpen }: {
    items: OmniCollection[]; onOpen: (album: OmniCollection) => void;
}) {
    const { t, i18n } = useTranslation();
    return <ol className="divide-y divide-current/10">{items.map((album, index) => {
        const position = album.ranking?.position ?? index + 1;
        const metric = album.ranking?.metric || 'plays';
        const value = album.ranking?.value;
        const Icon = METRIC_ICONS[metric];
        const description = album.description?.trim().split(/\r?\n\s*\r?\n|\u2029/, 1)[0]?.trim();
        const metricLabel = `${t(`discovery.rankingMetric.${metric}`)} ${value === undefined ? '—' : value.toLocaleString(i18n.resolvedLanguage || i18n.language)}`;
        return <li key={`${album.providerId}:${album.id}`} className="min-w-0">
            <button type="button" data-ranking-album={album.id} data-ranking-position={position} onClick={() => onOpen(album)}
                aria-label={album.name} aria-description={`${t('discovery.rankingPosition', { position })} · ${metricLabel}`}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg py-3 text-left hover:bg-current/5 focus-visible:outline focus-visible:outline-2 sm:gap-4">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${position <= 3 ? 'bg-current/10' : 'opacity-60'}`}>{position}</span>
                <DiscoveryCover url={album.coverUrl} className="h-20 w-20 sm:h-24 sm:w-24" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold sm:text-base">{album.name}</span>
                    {description && <span className="mt-1 line-clamp-1 whitespace-pre-line text-xs leading-5 opacity-70">{description}</span>}
                    {album.publisher && <span className="mt-1 block truncate text-xs opacity-70">{album.publisher}</span>}
                </span>
                <span aria-label={metricLabel} className="flex shrink-0 items-center gap-1 pr-1 text-xs font-medium tabular-nums opacity-75 sm:gap-2 sm:text-sm">
                    <Icon size={16} aria-hidden="true" /><span>{formatDiscoveryCount(value)}</span>
                </span>
            </button>
        </li>;
    })}</ol>;
}

function DiscoveryRankingPodium({ items, onOpen }: { items: OmniCollection[]; onOpen: (album: OmniCollection) => void }) {
    const { t, i18n } = useTranslation();
    // DOM 与视觉顺序一致；缺席的名次保留槽位，不提升其他专辑或按指标重新排名。
    return <ol data-ranking-podium className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-end gap-3 pt-4 pb-2 sm:gap-8 sm:pt-6">
        {[2, 1, 3].map(position => {
            const album = items.find(item => item.ranking?.position === position);
            if (!album) return <li key={position} aria-hidden="true" />;
            const metric = album.ranking!.metric;
            const value = album.ranking!.value;
            const Icon = METRIC_ICONS[metric];
            const metricLabel = `${t(`discovery.rankingMetric.${metric}`)} ${value === undefined ? '—' : value.toLocaleString(i18n.resolvedLanguage || i18n.language)}`;
            const coverSize = position === 1 ? 'w-full max-w-56' : position === 2 ? 'w-full max-w-46' : 'w-[86%] max-w-40';
            return <li key={position} value={position} className="min-w-0">
                <button type="button" data-ranking-album={album.id} data-ranking-position={position} onClick={() => onOpen(album)}
                    aria-label={album.name} aria-description={`${t('discovery.rankingPosition', { position })} · ${metricLabel}`}
                    className="group flex w-full min-w-0 flex-col items-center rounded-xl text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    <DiscoveryCover url={album.coverUrl} className={`aspect-square ${coverSize} transition-opacity group-hover:opacity-85`} />
                    <span className="mt-3 line-clamp-2 h-10 w-full text-xs font-semibold leading-5 sm:text-sm">{album.name}</span>
                    <span className="mt-1 block h-4 w-full truncate text-[11px] leading-4 opacity-70 sm:text-xs">{album.publisher}</span>
                    <span aria-label={metricLabel} className="mt-2 flex items-center justify-center gap-1 text-xs font-medium tabular-nums opacity-80 sm:text-sm">
                        <Icon size={14} aria-hidden="true" />{formatDiscoveryCount(value)}
                    </span>
                </button>
            </li>;
        })}
    </ol>;
}

export function DiscoveryRankingPreview({ sections, selectedId, onSelect, onMore, onOpen }: {
    sections: HomeDiscoverySection[]; selectedId: string;
    onSelect: (section: HomeDiscoverySection) => void; onMore: (section: HomeDiscoverySection) => void;
    onOpen: (album: OmniCollection) => void;
}) {
    const { t } = useTranslation();
    const [direction, setDirection] = useState(1);
    const active = sections.find(section => section.moreId === selectedId) || sections[0];
    if (!active) return null;
    return <section data-testid="discovery-ranking-preview" aria-label={t('discovery.rankings')} className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t('discovery.rankings')}</h2>
            <button type="button" onClick={() => onMore(active)} aria-label={t('discovery.openSection', { name: active.title })}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs opacity-75 hover:bg-current/5 focus-visible:outline focus-visible:outline-2">
                {t('discovery.more')}<ChevronRight size={14} aria-hidden="true" />
            </button>
        </div>
        <div className="mx-auto w-fit max-w-full">
            <DiscoveryRankingTabs sections={sections} selectedId={active.moreId} onSelect={next => {
                setDirection(sections.indexOf(next) >= sections.indexOf(active) ? 1 : -1); onSelect(next);
            }} />
        </div>
        <div className="-mx-1 mt-3 overflow-hidden p-1">
            <DiscoveryRankingTransition transitionKey={active.id} direction={direction}>
                {active.items.length > 0 && <DiscoveryRankingPodium items={active.items} onOpen={onOpen} />}
                {!active.items.length && <p className="py-8 text-sm opacity-70">{t('discovery.empty')}</p>}
            </DiscoveryRankingTransition>
        </div>
    </section>;
}
