import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { readReducedMotion } from '../stores/useMotionSettingsStore';

// src/hooks/useDragToScroll.ts
// Shared mouse drag-to-scroll; touch and trackpad keep native scrolling.

/** Movement past this many pixels counts as a drag, so the release does not also select a chip. */
const DRAG_THRESHOLD_PX = 5;

export interface DragToScrollBinding {
    isDragging: boolean;
    cancelDrag: () => void;
    /** True when the pointer moved far enough that the release should not be treated as a click. */
    hasDragged: () => boolean;
    handlers: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp'
        | 'onPointerCancel' | 'onLostPointerCapture' | 'onPointerLeave' | 'onClickCapture'
        | 'onDragStart' | 'onWheelCapture' | 'onKeyDownCapture'>;
}

interface DragSession {
    pointerId: number;
    startX: number;
    startY: number;
    startScroll: number;
    lastScroll: number;
    lastTime: number;
    velocity: number;
    dragged: boolean;
}

export const useDragToScroll = (scrollContainerRef: React.RefObject<HTMLDivElement | null>, { momentum = false, axis = 'x' }: { momentum?: boolean; axis?: 'x' | 'y' } = {}): DragToScrollBinding => {
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<DragSession | null>(null);
    const hasDraggedRef = useRef(false);
    const momentumFrameRef = useRef<number | null>(null);
    const scrollKey = axis === 'x' ? 'scrollLeft' : 'scrollTop';
    const extentKey = axis === 'x' ? 'scrollWidth' : 'scrollHeight';
    const viewportKey = axis === 'x' ? 'clientWidth' : 'clientHeight';

    const stopMomentum = useCallback(() => {
        if (momentumFrameRef.current !== null) cancelAnimationFrame(momentumFrameRef.current);
        momentumFrameRef.current = null;
    }, []);

    // Use the slider's frame-rate-independent friction, stopping immediately at either edge.
    const startMomentum = (initialVelocity: number) => {
        stopMomentum();
        if (!momentum || readReducedMotion('uiMicroMotion')) return;
        let velocity = Math.max(-6, Math.min(6, initialVelocity));
        let lastTime = performance.now();
        const tick = (now: number) => {
            const container = scrollContainerRef.current;
            if (!container) { stopMomentum(); return; }
            const elapsed = Math.min(now - lastTime, 32);
            lastTime = now;
            velocity *= Math.pow(0.80, elapsed / 16.67);
            const before = container[scrollKey];
            const max = Math.max(0, container[extentKey] - container[viewportKey]);
            if (Math.abs(velocity) < 0.03) { stopMomentum(); return; }
            container[scrollKey] = Math.max(0, Math.min(max, before + velocity * elapsed));
            if (Math.abs(container[scrollKey] - before) < 0.1) { stopMomentum(); return; }
            momentumFrameRef.current = requestAnimationFrame(tick);
        };
        momentumFrameRef.current = requestAnimationFrame(tick);
    };

    const finishDrag = (event: React.PointerEvent<HTMLDivElement>, coast: boolean) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId);
        if (!drag.dragged) return;
        setIsDragging(false);
        if (coast && performance.now() - drag.lastTime < 100) startMomentum(drag.velocity);
    };

    const cancelDrag = useCallback(() => {
        stopMomentum();
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag && scrollContainerRef.current?.hasPointerCapture(drag.pointerId)) scrollContainerRef.current.releasePointerCapture(drag.pointerId);
        setIsDragging(false);
    }, [scrollContainerRef, stopMomentum]);

    useEffect(() => {
        window.addEventListener('blur', cancelDrag);
        return () => { window.removeEventListener('blur', cancelDrag); stopMomentum(); dragRef.current = null; };
    }, [cancelDrag, stopMomentum]);

    return {
        isDragging,
        cancelDrag,
        hasDragged: () => hasDraggedRef.current,
        handlers: {
            onPointerDown: event => {
                if (!event.isPrimary || event.button !== 0) return;
                stopMomentum();
                hasDraggedRef.current = false;
                const container = scrollContainerRef.current;
                if (!container || event.pointerType === 'touch' || event.defaultPrevented
                    || container[extentKey] <= container[viewportKey] + 1
                    || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="listbox"], button[aria-haspopup]'))) return;
                dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
                    startScroll: container[scrollKey], lastScroll: container[scrollKey], lastTime: performance.now(), velocity: 0, dragged: false };
            },
            onPointerMove: event => {
                const drag = dragRef.current;
                const container = scrollContainerRef.current;
                if (!drag || !container || event.pointerId !== drag.pointerId) return;
                // A nested scroller claims its direction with preventDefault; the other axis yields for this gesture.
                if (event.defaultPrevented || event.buttons !== 1) { finishDrag(event, false); return; }
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                const delta = axis === 'x' ? dx : dy;
                const crossDelta = axis === 'x' ? dy : dx;
                if (!drag.dragged) {
                    if (Math.max(Math.abs(delta), Math.abs(crossDelta)) <= DRAG_THRESHOLD_PX) return;
                    if (Math.abs(delta) < Math.abs(crossDelta)) { dragRef.current = null; return; }
                    drag.dragged = true;
                    hasDraggedRef.current = true;
                    setIsDragging(true);
                    event.currentTarget.setPointerCapture(event.pointerId);
                }
                event.preventDefault();
                container[scrollKey] = drag.startScroll - delta * 1.5;
                const now = performance.now();
                const elapsed = Math.max(1, now - drag.lastTime);
                drag.velocity = (container[scrollKey] - drag.lastScroll) / elapsed;
                drag.lastScroll = container[scrollKey];
                drag.lastTime = now;
            },
            onPointerUp: event => finishDrag(event, true),
            onPointerCancel: event => finishDrag(event, false),
            onLostPointerCapture: event => finishDrag(event, false),
            onPointerLeave: () => { if (!dragRef.current?.dragged) dragRef.current = null; },
            onClickCapture: event => {
                const suppress = hasDraggedRef.current && event.detail !== 0;
                hasDraggedRef.current = false;
                if (suppress) { event.preventDefault(); event.stopPropagation(); }
            },
            onDragStart: event => event.preventDefault(),
            onWheelCapture: stopMomentum,
            onKeyDownCapture: () => { stopMomentum(); hasDraggedRef.current = false; },
        },
    };
};

export default useDragToScroll;
