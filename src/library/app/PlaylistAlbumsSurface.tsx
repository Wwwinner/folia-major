import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { ProviderCollection, ProviderPage } from '../../types/onlineMusic';
import type { LibraryPlaylistAlbumsSurfaceProps } from '../core/suite/suite.contract';
import { collectionKey } from '../core/collection/collectionIdentity';
import { getLibrarySessionGeneration } from '../core/shared/useLibraryBrowseSessionStore';
import { omni } from '../../services/onlineMusic/omni';
import SearchCollectionRow from '../../components/app/search/SearchCollectionRow';
import WallBackButton from '../../components/wall/WallBackButton';
import { hasBlockingWindow } from '../../utils/keyboardTargets';
import '../../components/app/search/search.css';

// Native album lists share the same rows and navigation as the library's other collection entries.
const PAGE_SIZE = 20;
const INITIAL_PAGE = { items: [], nextOffset: 0, hasMore: false } satisfies ProviderPage<ProviderCollection>;
const ROW_STYLE = { height: 76 };
const MAX_REMEMBERED = 8;
const rememberedLists = new Map<string, { generation: number; page: ProviderPage<ProviderCollection>; scrollTop: number }>();

type PlaylistAlbumsSurfaceProps = Pick<LibraryPlaylistAlbumsSurfaceProps, 'collection' | 'isInteractive' | 'onBack' | 'onDone' | 'onOpenAlbum' | 'onPopTo'> & {
    visible: boolean;
    Wall?: React.ComponentType<LibraryPlaylistAlbumsSurfaceProps>;
};

const PlaylistAlbumsSurface: React.FC<PlaylistAlbumsSurfaceProps> = ({ collection, visible, isInteractive, onDone, onBack, onOpenAlbum, onPopTo, Wall }) => {
    const { t } = useTranslation();
    const interactive = useIsPresent() && isInteractive;
    // The shell keys this view by playlist identity; browser Back can replace its descriptor object.
    const latestCollection = useRef(collection);
    latestCollection.current = collection;
    const key = collectionKey(collection);
    const [generation] = useState(() => getLibrarySessionGeneration(key));
    const [initial] = useState(() => {
        const remembered = rememberedLists.get(key);
        return remembered?.generation === generation ? remembered : undefined;
    });
    const [page, setPage] = useState(initial?.page ?? INITIAL_PAGE);
    const [loading, setLoading] = useState(!initial);
    const [failed, setFailed] = useState(false);
    const latestPage = useRef(page);
    latestPage.current = page;
    const scroller = useRef<HTMLDivElement>(null);
    const scrollTop = useRef(initial?.scrollTop ?? 0);
    const request = useRef<AbortController | null>(null);

    const loadPage = useCallback(async (offset: number) => {
        if (request.current) return;
        const current = new AbortController();
        request.current = current;
        setLoading(true);
        setFailed(false);
        try {
            const result = await omni.getPlaylistAlbums(latestCollection.current, { limit: PAGE_SIZE, offset });
            if (current.signal.aborted) return;
            setPage(previous => {
                const items = offset === 0 ? [] : [...previous.items];
                const seen = new Set(items.map(album => String(album.id)));
                for (const album of result.items) {
                    const id = String(album.id);
                    if (seen.has(id)) continue;
                    seen.add(id);
                    items.push(album);
                }
                return { items, nextOffset: result.nextOffset, hasMore: result.hasMore && result.nextOffset > offset };
            });
        } catch (error) {
            if (current.signal.aborted) return;
            console.warn('[Library] Failed to read the albums of a playlist', error);
            setFailed(true);
        } finally {
            if (!current.signal.aborted) {
                request.current = null;
                setLoading(false);
            }
        }
    }, []);
    const onLoadPage = useCallback(() => { void loadPage(page.nextOffset); }, [loadPage, page.nextOffset]);

    // Browser Back/Escape leaves the browsing session; Done changes its generation before the exit.
    useLayoutEffect(() => () => {
        if (latestPage.current === INITIAL_PAGE || generation !== getLibrarySessionGeneration(key)) return;
        rememberedLists.delete(key);
        rememberedLists.set(key, { generation, page: latestPage.current, scrollTop: scrollTop.current });
        if (rememberedLists.size <= MAX_REMEMBERED) return;
        const oldest = rememberedLists.keys().next().value;
        if (oldest !== undefined) rememberedLists.delete(oldest);
    }, [key, generation]);

    useLayoutEffect(() => {
        if (visible && scroller.current) scroller.current.scrollTop = scrollTop.current;
    }, [visible, Wall]);

    useEffect(() => {
        if (!initial) void loadPage(0);
        return () => {
            request.current?.abort();
            request.current = null;
        };
    }, [initial, loadPage]);

    useEffect(() => {
        if (!interactive || Wall) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.repeat || hasBlockingWindow()) return;
            event.preventDefault();
            onBack();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [interactive, onBack, Wall]);

    if (Wall) return visible ? (
        <React.Suspense fallback={null}>
            <Wall collection={collection} albums={page.items} isInteractive={interactive}
                loading={loading} failed={failed} hasMore={page.hasMore} onLoadPage={onLoadPage}
                onBack={onBack} onDone={onDone} onPopTo={onPopTo} onOpenAlbum={onOpenAlbum} />
        </React.Suspense>
    ) : null;

    return (
        <motion.section
            data-library-surface="collection"
            data-library-host-surface="playlist-albums"
            inert={!interactive}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="search-workspace fixed inset-0 z-[110] flex flex-col overflow-hidden"
            style={{
                display: visible ? undefined : 'none',
                pointerEvents: interactive ? undefined : 'none',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-primary)',
                '--search-ink': 'var(--text-primary)',
                '--search-accent': 'var(--text-accent)',
                '--search-paper': 'var(--bg-color)',
            } as React.CSSProperties}
        >
            <header className="mx-auto w-full max-w-5xl shrink-0 border-b border-current/15 py-7 pl-20 pr-5">
                {interactive && <WallBackButton label={t('ui.back')} onBack={onDone} />}
                <h2 className="truncate text-lg font-bold">{collection.name}</h2>
            </header>
            <div ref={scroller} onScroll={event => { if (visible) scrollTop.current = event.currentTarget.scrollTop; }}
                className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-5 pb-28 sm:px-8">
                {page.items.map((album, index) => (
                    <SearchCollectionRow
                        key={album.id}
                        collection={album}
                        index={index}
                        style={ROW_STYLE}
                        hideTrackCount
                        onOpenCollection={() => { if (interactive) onOpenAlbum(album.id, album); }}
                    />
                ))}
                {failed && <p className="my-5 text-center text-sm opacity-70">{t('playlist.loadFailedPlain')}</p>}
                {loading && <p role="status" className="my-5 flex justify-center gap-2 text-sm opacity-70"><Loader2 size={16} className="animate-spin" />{t('playlist.loading')}</p>}
                {!loading && !failed && !page.items.length && !page.hasMore && <p className="my-5 text-center text-sm opacity-70">{t('playlist.noAlbums')}</p>}
                {!loading && (failed || page.hasMore) && (
                    <div className="my-5 flex justify-center">
                        <button type="button" disabled={!interactive} className="search-flat-button" onClick={onLoadPage}>
                            {t(failed ? 'ui.retry' : 'playlist.loadMore')}
                        </button>
                    </div>
                )}
            </div>
        </motion.section>
    );
};

export default PlaylistAlbumsSurface;
