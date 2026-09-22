import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDragToScroll } from '../../../hooks/useDragToScroll';
import { readReducedMotion } from '../../../stores/useMotionSettingsStore';

// 原生横向滚动与居中吸附；首尾镜像只负责衔接，不增加重复的键盘入口。
export function useBannerCarousel(count: number) {
    const sectionRef = useRef<HTMLElement>(null);
    const railRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef(0);
    const geometry = useRef({ width: 0, step: 0 });
    const [active, setActive] = useState(0);
    const drag = useDragToScroll(railRef);
    const looped = count > 1;

    const normalizeClone = useCallback(() => {
        const rail = railRef.current;
        const { step } = geometry.current;
        if (!rail?.clientWidth || !looped || !step || rail.dataset.dragging === 'true') return;
        const slide = Math.round(rail.scrollLeft / step);
        if (Math.abs(rail.scrollLeft - slide * step) > 1) return;
        if (slide === 0 || slide === count + 1) {
            rail.scrollTo({ left: (slide === 0 ? count : 1) * step, behavior: 'instant' });
        }
    }, [count, looped]);

    const goTo = useCallback((index: number, focus = false) => {
        const rail = railRef.current;
        if (!rail || count < 1 || !geometry.current.step) return;
        drag.cancelDrag();
        const next = (index + count) % count;
        const slide = looped ? index < 0 ? 0 : index >= count ? count + 1 : next + 1 : 0;
        rail.scrollTo({ left: slide * geometry.current.step, behavior: readReducedMotion('uiMicroMotion') ? 'instant' : 'smooth' });
        if (focus) rail.querySelector<HTMLButtonElement>(`[data-banner-slide="${looped ? next + 1 : 0}"]`)?.focus({ preventScroll: true });
    }, [count, looped, drag.cancelDrag]);

    useEffect(() => {
        const section = sectionRef.current;
        const rail = railRef.current;
        if (!section || !rail || !looped) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let visible = false;
        let pressed = false;
        let disposed = false;
        let hovered = window.matchMedia('(hover: hover)').matches && section.matches(':hover');
        const stop = () => { clearTimeout(timer); timer = undefined; };
        const canAdvance = () => !disposed && visible && !hovered && !pressed && document.visibilityState === 'visible'
            && document.hasFocus() && rail.clientWidth > 0 && rail.dataset.dragging !== 'true'
            && !section.contains(document.activeElement);
        // 每次停稳后重新计时；隐藏、离屏和交互期间不保留轮播定时器。
        const arm = () => {
            stop();
            if (!canAdvance()) return;
            timer = setTimeout(() => {
                if (!canAdvance()) return;
                goTo(activeRef.current + 1);
                arm();
            }, 5000);
        };
        const enter = (event: PointerEvent) => { if (event.pointerType !== 'touch') { hovered = true; stop(); } };
        const leave = (event: PointerEvent) => { if (event.pointerType !== 'touch') { hovered = false; arm(); } };
        const press = () => { pressed = true; stop(); };
        const release = () => { pressed = false; arm(); };
        const focusOut = () => queueMicrotask(arm);
        const observer = new IntersectionObserver(([entry]) => { visible = entry.intersectionRatio >= 0.5; arm(); }, { threshold: 0.5 });
        observer.observe(section);
        section.addEventListener('pointerenter', enter, { passive: true });
        section.addEventListener('pointerleave', leave, { passive: true });
        section.addEventListener('pointerdown', press, { passive: true });
        section.addEventListener('focusin', arm);
        section.addEventListener('focusout', focusOut);
        rail.addEventListener('scroll', arm, { passive: true });
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        window.addEventListener('focus', arm);
        window.addEventListener('blur', stop);
        document.addEventListener('visibilitychange', arm);
        return () => {
            disposed = true; stop(); observer.disconnect();
            section.removeEventListener('pointerenter', enter);
            section.removeEventListener('pointerleave', leave);
            section.removeEventListener('pointerdown', press);
            section.removeEventListener('focusin', arm);
            section.removeEventListener('focusout', focusOut);
            rail.removeEventListener('scroll', arm);
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
            window.removeEventListener('focus', arm);
            window.removeEventListener('blur', stop);
            document.removeEventListener('visibilitychange', arm);
        };
    }, [looped, goTo]);

    useLayoutEffect(() => {
        const rail = railRef.current;
        if (!rail || !count) return;
        let frame = 0;
        const syncActive = () => {
            if (!rail.clientWidth || !geometry.current.step) return;
            const index = Math.round(rail.scrollLeft / geometry.current.step) - (looped ? 1 : 0);
            const next = (index + count) % count;
            if (activeRef.current !== next) { activeRef.current = next; setActive(next); }
        };
        const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; syncActive(); }); };
        const onScrollEnd = () => {
            if (!rail.clientWidth || rail.dataset.dragging === 'true') return;
            normalizeClone();
            syncActive();
        };
        // 只在容器宽度变化时更新几何，滚动过程只读取 scrollLeft 并切换离散页码。
        const resize = () => {
            const width = rail.clientWidth;
            if (width === geometry.current.width) return;
            if (geometry.current.width > 0) syncActive();
            geometry.current.width = width;
            if (!width) return;
            const slideWidth = Math.min(Math.max(width - 40, 0), 608);
            geometry.current.step = slideWidth + 16;
            rail.style.setProperty('--banner-width', `${slideWidth}px`);
            rail.style.setProperty('--banner-side', `${(width - slideWidth) / 2}px`);
            activeRef.current = Math.min(activeRef.current, count - 1);
            setActive(previous => previous === activeRef.current ? previous : activeRef.current);
            rail.scrollTo({ left: (activeRef.current + (looped ? 1 : 0)) * geometry.current.step, behavior: 'instant' });
        };
        geometry.current.width = 0;
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(rail);
        rail.addEventListener('scroll', onScroll, { passive: true });
        rail.addEventListener('scrollend', onScrollEnd);
        return () => {
            observer.disconnect();
            rail.removeEventListener('scroll', onScroll);
            rail.removeEventListener('scrollend', onScrollEnd);
            cancelAnimationFrame(frame);
        };
    }, [count, looped, normalizeClone]);

    useLayoutEffect(() => {
        if (!drag.isDragging) normalizeClone();
    }, [drag.isDragging, normalizeClone]);

    return { sectionRef, railRef, active, drag, goTo };
}
