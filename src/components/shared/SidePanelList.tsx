import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Play, Plus } from 'lucide-react';
import { List as VirtualList } from 'react-window';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../utils/coverUrl';
import { getSongArtistLabel, getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import { useSidePanelBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';

export interface SidePanelListProps<T> {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    items: T[];
    renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
    itemHeight: number;
    columns?: 1 | 2;
    isDaylight: boolean;
    focusedIndex?: number;
    hideTitle?: boolean;
    headerLeadingActions?: React.ReactNode;
    headerActions?: React.ReactNode;
}

const RowComponent = ({ index, style, items, renderItem, columns }: any): React.ReactElement => {
    if (columns === 1) return <>{renderItem(items[index], index, style)}</>;
    // 虚拟列表以行为单位，格子始终按原始项目索引取值，末行允许只有一项。
    const start = index * columns;
    return <div style={{ ...style, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {items.slice(start, start + columns).map((item: unknown, offset: number) => (
            <React.Fragment key={start + offset}>
                {renderItem(item, start + offset, { height: '100%', minWidth: 0 })}
            </React.Fragment>
        ))}
    </div>;
};

export function SidePanelList<T>({
    isOpen,
    onClose,
    title,
    items,
    renderItem,
    itemHeight,
    columns = 1,
    isDaylight,
    focusedIndex,
    hideTitle = false,
    headerLeadingActions,
    headerActions,
}: SidePanelListProps<T>) {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const [listHeight, setListHeight] = useState(400);
    const measuredHeightRef = useRef(400);
    const listContainerRef = useRef<HTMLDivElement>(null);
    const virtualListRef = useRef<any>(null);
    const bottomBarBottomPx = useSidePanelBottomPx();
    const previousLayoutRef = useRef({ columns, itemHeight });
    const scrollTopRef = useRef(0);

    const rowProps = React.useMemo(() => ({ items, renderItem, columns }), [items, renderItem, columns]);
    const rowCount = Math.ceil(items.length / columns);
    const focusedRow = focusedIndex === undefined || rowCount === 0 ? undefined
        : Math.max(0, Math.min(rowCount - 1, Math.floor(focusedIndex / columns)));

    // Measure list container height for react-window
    useEffect(() => {
        if (isOpen && listContainerRef.current) {
            const el = listContainerRef.current;
            const measureHeight = () => {
                const height = el.clientHeight;
                if (height === measuredHeightRef.current) return;
                measuredHeightRef.current = height;
                setListHeight(height);
            };
            measureHeight();
            const observer = new ResizeObserver(measureHeight);
            observer.observe(el);
            return () => observer.disconnect();
        }
    }, [isOpen]);

    const lastScrollTargetRef = useRef<number | null>(null);

    // Scroll to focused index when opened or focused index changes
    useLayoutEffect(() => {
        const previousLayout = previousLayoutRef.current;
        previousLayoutRef.current = { columns, itemHeight };
        if (isOpen && previousLayout.columns !== columns && virtualListRef.current?.element) {
            // 改列数时先把首个可见分集映射到新行，避免宽度过渡中突然跳回旧焦点。
            const list = virtualListRef.current;
            const previousTop = scrollTopRef.current;
            const firstItem = Math.floor(previousTop / previousLayout.itemHeight) * previousLayout.columns;
            const rowFraction = (previousTop % previousLayout.itemHeight) / previousLayout.itemHeight;
            list.element.scrollTop = (Math.floor(firstItem / columns) + rowFraction) * itemHeight;
            if (focusedIndex !== undefined && focusedRow !== undefined) {
                const previousFocusTop = Math.floor(focusedIndex / previousLayout.columns) * previousLayout.itemHeight;
                if (previousFocusTop >= previousTop && previousFocusTop + previousLayout.itemHeight <= previousTop + listHeight) {
                    list.scrollToRow({ index: focusedRow, align: 'smart', behavior: 'auto' });
                }
            }
            scrollTopRef.current = list.element.scrollTop;
            return;
        }
        if (isOpen && focusedRow !== undefined && virtualListRef.current) {
            // Use a small timeout to ensure the list has rendered first
                const isInitialOpen = lastScrollTargetRef.current === null;
                const delay = isInitialOpen ? 50 : 350; // Debounce subsequent scroll updates
                
                let settleTimer: ReturnType<typeof setTimeout> | undefined;
                const timer = setTimeout(() => {
                    const list = virtualListRef.current;
                    if (!list) return;
    
                    // If opening panel for the first time
                    if (isInitialOpen) {
                        // Start from nearby (e.g. 8 items above) to create a short smooth scroll effect
                        const jumpIndex = Math.max(0, focusedRow - 8);
                        list.scrollToRow({ index: jumpIndex, align: 'start', behavior: 'auto' });
                        
                        settleTimer = setTimeout(() => {
                            list.scrollToRow({ index: focusedRow, align: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
                        }, 50);
                    } else {
                        // If already open, just smoothly scroll to the target directly
                        list.scrollToRow({ index: focusedRow, align: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
                    }
                    
                    lastScrollTargetRef.current = focusedRow;
                }, delay);
                return () => { clearTimeout(timer); clearTimeout(settleTimer); };
            } else if (!isOpen) {
                lastScrollTargetRef.current = null;
            }
    }, [isOpen, focusedIndex, focusedRow, columns, itemHeight, listHeight, reducedMotion]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, x: reducedMotion ? 0 : 60, scale: reducedMotion ? 1 : 0.95,
                        width: columns === 2 ? '30rem' : '20rem' }}
                    animate={{ opacity: 1, x: 0, scale: 1, width: columns === 2 ? '30rem' : '20rem' }}
                    exit={{ opacity: 0, x: reducedMotion ? 0 : 60, scale: reducedMotion ? 1 : 0.95 }}
                    transition={{ duration: reducedMotion ? 0.12 : 0.35, ease: [0.16, 1, 0.3, 1],
                        width: { duration: reducedMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] } }}
                    data-testid="side-panel-list"
                    data-columns={columns}
                    className="absolute right-6 top-24 max-w-[calc(100vw-3rem)] rounded-3xl z-[80] flex flex-col p-6 shadow-2xl border backdrop-blur-2xl pointer-events-auto theme-glass-panel"
                    style={{
                        bottom: bottomBarBottomPx,
                        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                        color: 'var(--text-primary)'
                    }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-4 shrink-0">
                        <div className="min-w-0 flex-1">
                            {headerLeadingActions}
                            {!hideTitle && (
                                <h3 className="font-bold text-lg tracking-tight truncate pr-2">
                                    {title}
                                </h3>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {headerActions}
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* List Area */}
                    <div ref={listContainerRef} className="flex-1 overflow-hidden relative rounded-xl">
                        {items.length === 0 ? (
                            <div className="absolute inset-0 flex items-center justify-center opacity-50 text-sm">
                                {t('home.loadingLibrary') || 'No items'}
                            </div>
                        ) : (
                            <VirtualList
                                listRef={virtualListRef}
                                style={{ height: listHeight, width: '100%' }}
                                rowCount={rowCount}
                                rowHeight={itemHeight}
                                rowProps={rowProps}
                                rowComponent={RowComponent}
                                onScroll={event => { scrollTopRef.current = event.currentTarget.scrollTop; }}
                                className="overflow-x-hidden custom-scrollbar"
                            />
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// Reusable list item for tracks
export const TrackListItem = React.memo<{
    track: any;
    index: number;
    style: React.CSSProperties;
    onPlay: () => void;
    onAddToQueue?: () => void;
    isUnavailable?: boolean;
    isActive?: boolean;
    albumTrackLabel?: string | null;
}>(({ track, index, style, onPlay, onAddToQueue, isUnavailable, isActive, albumTrackLabel }) => {
    const { t } = useTranslation();
    const coverUrl = getSongCoverUrl(track) || '';
    const artistName = getSongArtistLabel(track).split(',')[0]?.trim() || 'Unknown Artist';
    
    return (
        <div 
            style={style} 
            className="px-2 py-1"
        >
            <div 
                onClick={isUnavailable ? undefined : onPlay}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors w-full h-full ${
                    isUnavailable 
                        ? 'opacity-40 cursor-not-allowed' 
                        : isActive
                            ? 'bg-black/10 dark:bg-white/10 cursor-pointer group'
                            : 'hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer group'
                }`}
            >
                <div className="relative w-10 h-10 shrink-0 rounded overflow-hidden bg-zinc-200 dark:bg-zinc-800">
                    {coverUrl && (
                        <img 
                            src={getSizedCoverUrl(coverUrl, 50)} 
                            alt={track.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    )}
                    {!isUnavailable && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play size={16} className="text-white fill-white ml-0.5" />
                        </div>
                    )}
                </div>
                <div className="flex flex-col min-w-0 flex-1 justify-center">
                    <div className="flex min-w-0 items-baseline gap-1.5 leading-tight">
                        <span className="text-sm font-semibold truncate">{track.name}</span>
                        {albumTrackLabel && (
                            <span className="shrink-0 text-[10px] font-medium tabular-nums opacity-45">
                                {albumTrackLabel}
                            </span>
                        )}
                    </div>
                    <div className="text-[10px] opacity-60 truncate leading-tight mt-0.5">{artistName}</div>
                </div>
                {!isUnavailable && onAddToQueue && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddToQueue();
                        }}
                        className="p-2 ml-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title={t('navidrome.addToQueue')}
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <Plus size={16} />
                    </button>
                )}
            </div>
        </div>
    );
});

// Reusable list item for collections
export const CollectionListItem = React.memo<{
    item: any;
    index: number;
    style: React.CSSProperties;
    onClick: () => void;
    isActive?: boolean;
}>(({ item, index, style, onClick, isActive }) => {
    return (
        <div 
            style={style} 
            className="px-2 py-1"
        >
            <div 
                onClick={onClick}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors w-full h-full ${
                    isActive
                        ? 'bg-black/10 dark:bg-white/10 cursor-pointer group'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer group'
                }`}
            >
                <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-zinc-200 dark:bg-zinc-800 relative">
                    {item.coverUrl && (
                        <img 
                            src={getSizedCoverUrl(item.coverUrl, 512)}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    )}
                </div>
                <div className="flex flex-col min-w-0 flex-1 justify-center">
                    <div className="text-sm font-semibold truncate leading-tight">{item.name}</div>
                    {item.description && (
                        <div className="text-[10px] opacity-60 truncate leading-tight mt-0.5">{item.description}</div>
                    )}
                </div>
            </div>
        </div>
    );
});
