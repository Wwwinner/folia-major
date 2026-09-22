import { useState, type ReactNode } from 'react';
import { Disc3, ChevronRight, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HomeDiscoverySection, OmniCollection } from '../../../types/onlineMusic';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { HorizontalScrollRow } from '../../shared/HorizontalScrollRow';

// 沿用 Folia 封面与文字层级；普通发现页卡片直接进入专辑，不引入 3D 居中手势。
export const discoveryGridClass = 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';
export function DiscoveryCover({ url, promotionLabel, children, className = '' }: { url?: string; promotionLabel?: string; children?: ReactNode; className?: string }) {
    const [failedUrl, setFailedUrl] = useState('');
    return <span className={`relative block shrink-0 overflow-hidden rounded-xl bg-current/5 ${className}`}>
        {url && failedUrl !== url
            ? <img src={getSizedCoverUrl(url, 256)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailedUrl(url)} />
            : <span className="absolute inset-0 flex items-center justify-center"><Disc3 size={28} className="opacity-40" aria-hidden="true" /></span>}
        {promotionLabel && <span className="absolute left-0 top-0 max-w-full rounded-br-md bg-linear-to-r from-[#ff608a] to-[#ff9a74] px-1 py-1 text-[10px] font-normal leading-4 text-white [overflow-wrap:anywhere]">{promotionLabel}</span>}
        {children}
    </span>;
}

export function formatDiscoveryCount(count?: number) {
    return count === undefined ? '—' : count >= 10000 ? `${Math.floor(count / 1000) / 10}w`
        : count >= 1000 ? `${Math.floor(count / 100) / 10}k` : String(count);
}

export function DiscoveryPlayCount({ count }: { count?: number }) {
    const { t, i18n } = useTranslation();
    return <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-black/65 to-transparent px-2 pt-5 pb-1.5 text-xs leading-4 tabular-nums text-white"
        aria-label={count === undefined ? t('episodes.playCountUnknown') : t('episodes.playCount', { value: count.toLocaleString(i18n.resolvedLanguage || i18n.language) })}>
        <Play size={10} fill="currentColor" strokeWidth={0} aria-hidden="true" />{formatDiscoveryCount(count)}
    </span>;
}

export function DiscoveryAlbumCard({ album, onOpen, landscape = false }: { album: OmniCollection; onOpen: (album: OmniCollection) => void; landscape?: boolean }) {
    return <button type="button" data-discovery-album={album.id} onClick={() => onOpen(album)}
        className="group min-w-0 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
        <DiscoveryCover url={(landscape && album.landscapeCoverUrl) || album.coverUrl} promotionLabel={album.promotionLabel}
            className={`${landscape ? 'aspect-[2/1]' : 'aspect-square'} w-full transition-opacity group-hover:opacity-85`}>
            {landscape && <DiscoveryPlayCount count={album.playCount} />}
        </DiscoveryCover>
        <span className="mt-3 block truncate text-sm font-semibold">{album.name}</span>
        <span className="mt-1 block truncate text-xs opacity-70">{album.artists?.map(artist => artist.name).join(' / ') || album.publisher}</span>
    </button>;
}

function DiscoveryAlbumSummaryCard({ album, onOpen }: { album: OmniCollection; onOpen: (album: OmniCollection) => void }) {
    const { t } = useTranslation();
    const description = album.description?.trim().split(/\r?\n\s*\r?\n|\u2029/, 1)[0]?.trim();
    return <button type="button" data-discovery-album={album.id} onClick={() => onOpen(album)}
        className="flex min-w-0 gap-4 rounded-lg py-2 text-left hover:bg-current/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
        <DiscoveryCover url={album.posterUrl || album.coverUrl} promotionLabel={album.promotionLabel} className="aspect-[3/4] w-[7.2rem] self-start">
            <DiscoveryPlayCount count={album.playCount} />
        </DiscoveryCover>
        <span className="flex min-w-0 flex-1 flex-col py-0.5">
            <span className="block truncate text-sm font-semibold leading-5">{album.name}</span>
            {description && <span data-album-description className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-5 opacity-75">{description}</span>}
            {album.latestEpisodeName && <span data-album-update className="mt-auto block truncate pt-2 text-xs leading-4 opacity-70">
                {t('discovery.updatedTo', { name: album.latestEpisodeName })}
            </span>}
        </span>
    </button>;
}

export function DiscoveryAlbumSection({ section, onOpen, onMore }: {
    section: HomeDiscoverySection; onOpen: (album: OmniCollection) => void; onMore: (section: HomeDiscoverySection) => void;
}) {
    const { t } = useTranslation();
    const landscape = section.layout === 'landscape-grid';
    return <section data-discovery-section={section.id} aria-label={section.title} className="min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="min-w-0 text-lg font-semibold">{section.title}</h2>
            {section.moreId && <button type="button" onClick={() => onMore(section)}
                aria-label={t('discovery.openSection', { name: section.title })}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs opacity-75 hover:bg-current/5 focus-visible:outline focus-visible:outline-2">
                {t('discovery.more')}<ChevronRight size={14} />
            </button>}
        </div>
        {['new-releases', 'romance', 'angst', 'scenarios'].includes(section.moreId || '') ? <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map(album => <DiscoveryAlbumSummaryCard key={`${album.providerId}:${album.id}`} album={album} onOpen={onOpen} />)}
        </div> : landscape ? <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3">
            {section.items.map(album => <DiscoveryAlbumCard key={`${album.providerId}:${album.id}`} album={album} onOpen={onOpen} landscape />)}
        </div> : <HorizontalScrollRow label={section.title} className="auto-cols-[calc((100%-1rem)/2)] sm:auto-cols-[calc((100%-2rem)/3)] md:auto-cols-[calc((100%-3rem)/4)] lg:auto-cols-[calc((100%-5rem)/6)]">
            {section.items.map(album => <DiscoveryAlbumCard key={`${album.providerId}:${album.id}`} album={album} onOpen={onOpen} />)}
        </HorizontalScrollRow>}
    </section>;
}
