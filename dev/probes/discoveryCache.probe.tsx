import { useEffect, useRef, useState } from 'react';
import { omni } from '../../src/services/onlineMusic/omni';
import { loadProviderHomeSnapshot, saveProviderHomeSnapshot } from '../../src/services/onlineMusic/providerHomeCache';
import { useDiscoveryHome } from '../../src/components/app/home/useDiscoveryHome';
import type { HomeDiscoverySection, OmniPage } from '../../src/types/onlineMusic';
import type { ProbeDefinition } from './definition';

// 使用正式 hook 与真实 IndexedDB，控制网络完成顺序以覆盖缓存/刷新/来源切换的竞态。
const makePage = (provider: string, title: string, offset = 0): OmniPage<HomeDiscoverySection> => ({
    items: [{ id: `${provider}:${offset}`, title, kind: 'albums', items: [{ id: '1', name: title, providerId: provider, type: 'album' }] }],
    hasMore: offset === 0, nextOffset: offset + 20,
});
function Home({ provider }: { provider: string }) {
    const data = useDiscoveryHome(provider, 'recommendations');
    return <section>
        <output data-testid="cache-loading">{String(data.homeLoading)}</output>
        <output data-testid="cache-error">{String(data.homeError)}</output>
        <output data-testid="cache-offset">{data.home.nextOffset}</output>
        <ul>{data.home.items.map(section => <li key={section.id}>{section.title}</li>)}</ul>
        <button onClick={() => void data.loadHome(data.home.nextOffset)}>加载下一页</button>
    </section>;
}
function DiscoveryCacheProbe({ fastNetwork = false }: { fastNetwork?: boolean }) {
    const [ready, setReady] = useState(false);
    const [provider, setProvider] = useState('fanjiao');
    const currentProvider = useRef(provider);
    const requests = useRef<Array<{ provider: string; offset: number; resolve: (page: OmniPage<HomeDiscoverySection>) => void; reject: (error: Error) => void }>>([]);
    useEffect(() => {
        let alive = true;
        const getHome = omni.getHomeSections, getFilters = omni.getCollectionBrowseFilters;
        omni.getHomeSections = async ({ offset } = { limit: 20, offset: 0 }) => {
            const selected = currentProvider.current;
            if (fastNetwork) return makePage(selected, '网络新首页', offset);
            return new Promise((resolve, reject) => requests.current.push({ provider: selected, offset, resolve, reject }));
        };
        omni.getCollectionBrowseFilters = async () => [];
        void (async () => {
            for (const id of ['fanjiao', 'other']) {
                if (!await loadProviderHomeSnapshot(id)) await saveProviderHomeSnapshot(id, makePage(id, `${id} 缓存首页`));
            }
            if (alive) setReady(true);
        })();
        return () => { alive = false; omni.getHomeSections = getHome; omni.getCollectionBrowseFilters = getFilters; };
    }, [fastNetwork]);
    const finish = (selected: string, fail = false) => {
        for (const request of requests.current.filter(item => item.provider === selected)) {
            if (fail) request.reject(new Error('offline'));
            else request.resolve(makePage(selected, `${selected} 网络新首页 ${request.offset}`, request.offset));
        }
        requests.current = requests.current.filter(item => item.provider !== selected);
    };
    return <main className="space-y-4 p-8 text-white bg-black min-h-screen">
        <button onClick={() => finish('fanjiao')}>完成饭角请求</button>
        <button onClick={() => finish('fanjiao', true)}>饭角请求失败</button>
        <button onClick={() => { currentProvider.current = 'other'; setProvider('other'); }}>切换来源</button>
        <button onClick={() => finish('other')}>完成另一来源请求</button>
        {ready && <Home key={provider} provider={provider} />}
    </main>;
}
export default { id: 'discoveryCache', title: '首页缓存与后台刷新', description: '缓存优先、竞态和来源隔离。', Component: DiscoveryCacheProbe } satisfies ProbeDefinition;
