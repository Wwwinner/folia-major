import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { omni } from '../../../services/onlineMusic/omni';
import { loadProviderHomeSnapshot, saveProviderHomeSnapshot } from '../../../services/onlineMusic/providerHomeCache';
import type { CollectionBrowseFilter, CollectionBrowseQuery, HomeDiscoverySection, OmniCollection, OmniPage } from '../../../types/onlineMusic';

// 发现页各组分页独立保存；请求序号防止筛选、栏目或数据源切换后的旧响应覆盖新结果。
export type DiscoveryView = 'recommendations' | 'browse';
const emptyPage = <T>(): OmniPage<T> => ({ items: [], hasMore: false, nextOffset: 0 });

export function useDiscoveryHome(providerId: string, view: DiscoveryView, sectionId?: string) {
    const [home, setHome] = useState(emptyPage<HomeDiscoverySection>);
    const [browse, setBrowse] = useState(emptyPage<OmniCollection>);
    const [sectionPage, setSectionPage] = useState(emptyPage<OmniCollection>);
    const [sectionLoading, setSectionLoading] = useState(false);
    const [sectionError, setSectionError] = useState(false);
    const [filters, setFilters] = useState<CollectionBrowseFilter[]>([]);
    const [query, setQuery] = useState<CollectionBrowseQuery>({});
    const [homeLoading, setHomeLoading] = useState(true);
    const [browseLoading, setBrowseLoading] = useState(false);
    const [homeError, setHomeError] = useState(false);
    const [browseError, setBrowseError] = useState(false);
    const [filtersError, setFiltersError] = useState(false);
    const requests = useRef({ home: 0, browse: 0, filters: 0, section: 0 });
    const hasHome = useRef(false);

    const loadHome = useCallback(async (offset = 0) => {
        const request = ++requests.current.home;
        setHomeLoading(true); setHomeError(false);
        let receivedFreshPage = false;
        if (offset === 0 && !hasHome.current) void loadProviderHomeSnapshot(providerId).then(cached => {
            if (!cached?.items.length || receivedFreshPage || request !== requests.current.home) return;
            hasHome.current = cached.items.length > 0;
            setHome(cached); setHomeError(false);
        });
        try {
            const page = await omni.getHomeSections({ limit: 20, offset });
            if (request !== requests.current.home) return;
            receivedFreshPage = true;
            hasHome.current = offset > 0 ? hasHome.current || page.items.length > 0 : page.items.length > 0;
            setHome(previous => ({ ...page, items: offset === 0 ? page.items
                : [...new Map([...previous.items, ...page.items].map(section => [section.id, section])).values()] }));
            if (offset === 0) void saveProviderHomeSnapshot(providerId, page);
        } catch { if (request === requests.current.home) setHomeError(offset > 0 || !hasHome.current); }
        finally { if (request === requests.current.home) setHomeLoading(false); }
    }, [providerId]);

    const loadFilters = useCallback(async () => {
        const request = ++requests.current.filters;
        setFiltersError(false);
        try {
            const next = await omni.getCollectionBrowseFilters();
            if (request !== requests.current.filters) return;
            setFilters(next);
            setQuery(previous => Object.fromEntries(next.map(filter => [filter.key,
                filter.options.some(option => option.value === previous[filter.key]) ? previous[filter.key] : filter.options[0]?.value])));
        } catch { if (request === requests.current.filters) setFiltersError(true); }
    }, []);

    const loadBrowse = useCallback(async (offset = 0) => {
        const request = ++requests.current.browse;
        setBrowseLoading(true); setBrowseError(false);
        if (offset === 0) setBrowse(emptyPage());
        try {
            const page = await omni.browseCollections(query, { limit: 24, offset });
            if (request !== requests.current.browse) return;
            setBrowse(previous => ({ ...page, items: offset === 0 ? page.items
                : [...new Map([...previous.items, ...page.items].map(album => [`${album.providerId}:${album.id}`, album])).values()] }));
        } catch { if (request === requests.current.browse) setBrowseError(true); }
        finally { if (request === requests.current.browse) setBrowseLoading(false); }
    }, [query]);

    const loadSection = useCallback(async (offset = 0) => {
        if (!sectionId) return;
        const request = ++requests.current.section;
        setSectionLoading(true); setSectionError(false);
        if (offset === 0) setSectionPage(emptyPage());
        try {
            const page = await omni.getDiscoverySectionCollections(sectionId, { limit: 20, offset });
            if (request !== requests.current.section) return;
            setSectionPage(previous => {
                const items = offset === 0 ? page.items
                    : [...new Map([...previous.items, ...page.items].map(album => [`${album.providerId}:${album.id}`, album])).values()];
                // 未知总数的榜单若重复返回旧页，保留当前列表并停止继续加载。
                return { ...page, items, hasMore: page.hasMore && page.items.length > 0
                    && (offset === 0 || items.length > previous.items.length) };
            });
        } catch { if (request === requests.current.section) setSectionError(true); }
        finally { if (request === requests.current.section) setSectionLoading(false); }
    }, [sectionId]);

    useEffect(() => {
        void loadHome(); void loadFilters();
        return () => { requests.current.home++; requests.current.browse++; requests.current.filters++; requests.current.section++; };
    }, [loadHome, loadFilters]);
    useEffect(() => {
        if (view === 'browse' && filters.length) void loadBrowse();
        return () => { requests.current.browse++; };
    }, [view, filters.length, loadBrowse]);
    useLayoutEffect(() => {
        if (sectionId) void loadSection();
        return () => { requests.current.section++; };
    }, [sectionId, loadSection]);

    return { home, browse, filters, query, setQuery, homeLoading, browseLoading, homeError, browseError,
        filtersError, loadHome, loadBrowse, loadFilters, sectionPage, sectionLoading, sectionError, loadSection };
}
