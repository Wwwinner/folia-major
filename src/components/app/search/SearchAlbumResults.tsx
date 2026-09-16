import { useEffect, useRef } from 'react';
import { ChevronRight, Disc3 } from 'lucide-react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import type { ProviderCollection } from '../../../types/onlineMusic';

// 专辑搜索使用现有虚拟列表；点击进入分集目录，专辑本身不是播放队列中的音频。
type AlbumRowsProps = { albums: ProviderCollection[]; isDaylight: boolean; onOpen: (album: ProviderCollection) => void };
function AlbumRow({ index, style, albums, isDaylight, onOpen }: RowComponentProps<AlbumRowsProps>) {
    const album = albums[index];
    return <div style={style} className="px-1 py-1">
        <button type="button" onClick={() => onOpen(album)}
            className={`flex h-full w-full items-center gap-4 rounded-xl px-3 text-left focus-visible:outline focus-visible:outline-2 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}>
            {album.coverUrl ? <img src={album.coverUrl} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                : <Disc3 className="h-14 w-14 shrink-0 p-3 opacity-40" />}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{album.name}</span>
                <span className="mt-1 block truncate text-xs opacity-50">{album.artists?.map(artist => artist.name).join('、') || album.publisher}</span>
            </span>
            <ChevronRight size={17} className="shrink-0 opacity-40" />
        </button>
    </div>;
}

export default function SearchAlbumResults({ scrollTop, onScrollTopChange, ...props }: AlbumRowsProps & {
    scrollTop: number; onScrollTopChange: (value: number) => void;
}) {
    const listRef = useListRef(null);
    const latest = useRef(scrollTop);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const element = listRef.current?.element;
        if (element && Math.abs(element.scrollTop - scrollTop) > 1) element.scrollTop = scrollTop;
        latest.current = scrollTop;
    }, [listRef, scrollTop, props.albums]);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
        onScrollTopChange(latest.current);
    }, [onScrollTopChange]);
    return <List listRef={listRef} rowComponent={AlbumRow} rowCount={props.albums.length} rowHeight={84}
        rowProps={props} overscanCount={6} className="custom-scrollbar" style={{ height: '100%', width: '100%' }}
        onScroll={event => {
            latest.current = event.currentTarget.scrollTop;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => onScrollTopChange(latest.current), 120);
        }} />;
}
