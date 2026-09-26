import { useRef, type ReactNode } from 'react';
import { useDragToScroll } from '../../hooks/useDragToScroll';

// 可拖动的横向内容行；触摸、触控板及键盘滚动由浏览器处理，鼠标拖动可惯性滑行。
export function HorizontalScrollRow({ label, children, className = '' }: {
    label: string; children: ReactNode; className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const { isDragging, handlers } = useDragToScroll(ref, { momentum: true });
    return <div ref={ref} {...handlers} role="region" aria-label={label} tabIndex={0}
        data-testid="horizontal-scroll-row"
        className={`-mx-1 -my-1 grid min-w-0 grid-flow-col gap-4 overflow-x-auto overscroll-x-contain p-1 select-none hide-scrollbar focus-visible:outline focus-visible:outline-2 ${isDragging ? 'cursor-grabbing [&_button]:cursor-grabbing' : 'cursor-default'} ${className}`}>
        {children}
    </div>;
}
