import { useCallback, useMemo } from 'react';
import { useIsPresent } from 'framer-motion';
import { ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LibraryPlaylistAlbumsSurfaceProps } from '../../core/suite/suite.contract';
import { collectionKey } from '../../core/collection/collectionIdentity';
import { filterArtistAlbums } from '../../core/artist/artistModel';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';
import type { BravaisSeamStatus } from './bravaisSeamModels';
import { formatEntryBadge } from './bravaisProjection';
import { useBravaisCollectionFilter } from './useBravaisCollectionFilter';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { useBravaisPopTo } from './useBravaisPopTo';
import { useBravaisSessionFocus } from './useBravaisSessionFocus';

// Project albums onto the same stage and seam as ordinary collections, without track actions.
const NO_QUEUED: ReadonlySet<string> = new Set();

export default function BravaisPlaylistAlbums({
    collection, albums, isInteractive, loading, failed, hasMore, onLoadPage, onOpenAlbum, onBack, onDone, onPopTo,
}: LibraryPlaylistAlbumsSurfaceProps) {
    const { t } = useTranslation();
    const present = useIsPresent();
    const isActive = isInteractive && present;
    const sessionKey = collectionKey(collection);
    const { initialKey, noteFocus, persistFocus } = useBravaisSessionFocus(sessionKey);
    const popTo = useBravaisPopTo(onPopTo);
    const { query, setQuery, committedQuery } = useBravaisCollectionFilter({ sessionKey, isActive });
    const filterKey = committedQuery.trim();
    const items = useMemo<BravaisItem[]>(() => {
        const matches = filterKey ? new Set(filterArtistAlbums(albums, filterKey)) : null;
        const entries: BravaisItem[] = [];
        for (const [index, album] of albums.entries()) {
            if (matches && !matches.has(album)) continue;
            entries.push({
                key: String(album.id),
                kind: 'album',
                title: album.name,
                subtitle: album.artists?.map(artist => artist.name).join(' / ') || album.publisher || '',
                coverUrl: album.coverUrl,
                coverVariants: album.coverVariants,
                badge: formatEntryBadge(index, albums.length),
                badgeIsIndex: true,
            });
        }
        return entries;
    }, [albums, filterKey]);
    const onOpenItem = useCallback((key: string) => {
        const album = albums.find(item => String(item.id) === key);
        if (!album) return;
        persistFocus(key);
        onOpenAlbum(album.id, album);
    }, [albums, onOpenAlbum, persistFocus]);

    const layer = useMemo<BravaisLayer>(() => {
        const matchLabel = t('libraryBravaisArtist.albumMatchCount', { matches: items.length, total: albums.length });
        const clearFilter = { id: 'clear-filter', label: t('libraryBravaisCollection.clearFilter'), run: () => setQuery('') } as const;
        let status: BravaisSeamStatus | undefined;
        if (failed) status = { tone: 'error', text: t('playlist.loadFailedPlain'), action: { id: 'retry', label: t('ui.retry'), run: onLoadPage } };
        if (loading) status = { tone: 'loading', text: t('playlist.loading') };
        if (!loading && !failed && items.length === 0 && (albums.length > 0 || !hasMore)) {
            status = filterKey
                ? { tone: 'no-match', text: t('home.gridSearchNoResults'), action: clearFilter }
                : { tone: 'empty', text: t('playlist.noAlbums') };
        }
        return {
            key: sessionKey,
            sessionKey,
            surface: 'collection',
            mode: filterKey ? 'finite' : 'infinite',
            items,
            wall: { filterKey, planCount: albums.length, loading: loading && albums.length === 0 },
            seam: {
                title: collection.name,
                crumb: collection.name,
                meta: filterKey ? matchLabel : t('libraryBravaisArtist.albumCount', { count: albums.length }),
                filter: { query, setQuery, matchLabel, placeholder: t('libraryBravaisArtist.filterPlaceholder'), clearLabel: clearFilter.label },
                collection: {
                    description: collection.description,
                    status,
                    moreLabel: t('libraryBravaisCollection.more'),
                    menu: hasMore && !failed ? [{ id: 'load-more-albums', label: t('playlist.loadMore'), icon: ListPlus, priority: 0, disabled: loading, run: onLoadPage }] : [],
                },
            },
            isInteractive: isActive,
            focusedEntryKey: initialKey,
            nowPlayingKey: null,
            queuedKeys: NO_QUEUED,
            onFocusEntry: noteFocus,
            onOpenItem,
            onBack,
            onDone,
            onPopTo: popTo,
            entries: {
                hasPanel: false,
                panelTitle: collection.name,
                listCrumb: collection.name,
                hasForm: false,
                hasQuery: Boolean(query),
                clearQuery: clearFilter.run,
            },
        };
    }, [albums.length, collection.description, collection.name, failed, filterKey, hasMore, initialKey, isActive, items, loading,
        noteFocus, onBack, onDone, onLoadPage, onOpenItem, popTo, query, sessionKey, setQuery, t]);
    useBravaisLayerRegistration('top', layer, present);

    const status = layer.seam.collection?.status;
    return (
        <>
            <div data-library-renderer="bravais" data-library-surface="collection" data-ponder-page-scope="bravais-wall"
                data-bravais-layer={sessionKey} data-bravais-mode={layer.mode} aria-hidden className="pointer-events-none fixed inset-0" />
            <span role="status" className="sr-only">
                {isActive && (status?.tone === 'loading' || status?.tone === 'error') ? status.text : ''}
            </span>
        </>
    );
}
