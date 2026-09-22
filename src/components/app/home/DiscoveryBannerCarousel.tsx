import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HomeDiscoveryBanner, OmniCollection } from '../../../types/onlineMusic';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { useBannerCarousel } from './useBannerCarousel';

// 官方主横幅保留原图比例，导航、分页和首尾镜像均沿用同一份专辑身份。
export default function DiscoveryBannerCarousel({ banners, onOpen }: {
    banners: HomeDiscoveryBanner[]; onOpen: (album: OmniCollection) => void;
}) {
    const { t } = useTranslation();
    const reduced = useReducedMotionFor('uiMicroMotion');
    const { sectionRef, railRef, active, drag, goTo } = useBannerCarousel(banners.length);
    const [failedImages, setFailedImages] = useState<string[]>([]);
    const looped = banners.length > 1;
    const slides = looped ? [banners[banners.length - 1], ...banners, banners[0]] : banners;
    if (!banners.length) return null;
    return <section ref={sectionRef} data-testid="discovery-banner" role="region" aria-label={t('discovery.bannerRecommendations')} aria-roledescription={t('discovery.carousel')} className="min-w-0">
        <div className="relative">
            <div ref={railRef} {...drag.handlers} data-testid="discovery-banner-rail" data-dragging={drag.isDragging}
                onKeyDown={event => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault(); event.stopPropagation();
                    goTo(active + (event.key === 'ArrowLeft' ? -1 : 1), true);
                }}
                className={`flex gap-4 overflow-x-auto overscroll-x-contain px-[var(--banner-side)] py-1 select-none hide-scrollbar [--banner-side:20px] [--banner-width:calc(100%-40px)] ${drag.isDragging ? 'snap-none cursor-grabbing [&_*]:cursor-grabbing' : 'snap-x snap-mandatory cursor-default'}`}>
                {slides.map((banner, index) => {
                    const clone = looped && (index === 0 || index === slides.length - 1);
                    const Slide = clone ? 'div' : 'button';
                    const originalIndex = (index - (looped ? 1 : 0) + banners.length) % banners.length;
                    return <Slide key={`${clone ? index : 'original'}:${banner.id}`} type={clone ? undefined : 'button'} data-banner-slide={index} data-banner-id={banner.id}
                        data-banner-clone={clone || undefined} tabIndex={clone ? undefined : 0} aria-hidden={clone || undefined}
                        aria-label={banner.title || t('discovery.bannerSlide', { index: originalIndex + 1 })} onClick={() => onOpen(banner.album)}
                        className={`relative block aspect-[69/25] w-[var(--banner-width)] shrink-0 snap-center overflow-hidden rounded-xl bg-current/5 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${originalIndex === active ? 'opacity-100' : 'opacity-65 hover:opacity-100'}`}
                        style={{ transitionDuration: reduced ? '0ms' : '200ms' }}>
                        {failedImages.includes(banner.imageUrl) ? <span className="flex h-full items-center justify-center gap-2 px-4 text-sm"><ImageOff size={20} aria-hidden="true" />{banner.title || t('discovery.bannerUnavailable')}</span>
                            : <img src={banner.imageUrl} alt="" draggable={false} loading={index < 3 ? 'eager' : 'lazy'} decoding="async" className="h-full w-full object-contain"
                                onError={() => setFailedImages(previous => previous.includes(banner.imageUrl) ? previous : [...previous, banner.imageUrl])} />}
                    </Slide>;
                })}
            </div>
            {looped && <>{[-1, 1].map(direction => <button key={direction} type="button" onClick={() => goTo(active + direction)}
                aria-label={t(direction < 0 ? 'discovery.previousBanner' : 'discovery.nextBanner')}
                className={`absolute top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline focus-visible:outline-2 sm:flex ${direction < 0 ? 'left-3' : 'right-3'}`}>
                {direction < 0 ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
            </button>)}</>}
        </div>
        {looped && <div className="mt-1 flex justify-center" role="group" aria-label={t('discovery.bannerPages')}>
            {banners.map((banner, index) => <button key={banner.id} type="button" onClick={() => goTo(index)} data-banner-dot={index}
                aria-label={t('discovery.bannerSlide', { index: index + 1 })} aria-current={index === active ? 'true' : undefined}
                className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2">
                <span className={`h-1.5 w-1.5 rounded-full bg-current ${index === active ? 'opacity-100' : 'opacity-30'}`} />
            </button>)}
        </div>}
    </section>;
}
