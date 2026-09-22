import type { HomeDiscoverySection, OmniPage, OnlineProviderId, ProviderCollection } from '../../types/onlineMusic';
import { getFromCache, saveToCache } from '../db';
import { getProviderCacheKey } from './providerStorage';

// 公共发现页只保存归一化首屏 DTO；按 provider 隔离，不保存播放地址或授权。
type HomePage = OmniPage<HomeDiscoverySection>;
type Snapshot = { version: 1; savedAt: number; page: HomePage };
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const getProviderHomeCacheKey = (provider: OnlineProviderId) => getProviderCacheKey(provider, 'discovery_home_v1');

const validAlbum = (album: ProviderCollection, provider: OnlineProviderId) => album
    && album.providerId === provider && ['string', 'number'].includes(typeof album.id) && typeof album.name === 'string';

export async function loadProviderHomeSnapshot(provider: OnlineProviderId): Promise<HomePage | null> {
    try {
        const snapshot = await getFromCache<Snapshot>(getProviderHomeCacheKey(provider));
        if (!snapshot || snapshot.version !== 1 || !Number.isFinite(snapshot.savedAt)
            || Date.now() - snapshot.savedAt > MAX_AGE_MS || snapshot.savedAt > Date.now() + 60000) return null;
        const page = snapshot.page;
        if (!page || !Array.isArray(page.items) || page.items.length > 100 || typeof page.hasMore !== 'boolean'
            || !Number.isSafeInteger(page.nextOffset) || page.nextOffset < 0) return null;
        if (!page.items.every(section => section && typeof section.id === 'string' && typeof section.title === 'string'
            && ['albums', 'ranking', 'banners'].includes(section.kind) && Array.isArray(section.items)
            && section.items.every(album => validAlbum(album, provider))
            && (section.banners === undefined || (Array.isArray(section.banners) && section.banners.every(banner => banner
                && typeof banner.id === 'string' && typeof banner.title === 'string' && typeof banner.imageUrl === 'string'
                && validAlbum(banner.album, provider)))))) return null;
        return page;
    } catch { return null; }
}

export async function saveProviderHomeSnapshot(provider: OnlineProviderId, page: HomePage): Promise<void> {
    try { await saveToCache(getProviderHomeCacheKey(provider), { version: 1, savedAt: Date.now(), page } satisfies Snapshot); }
    catch { /* 缓存不可用时仍正常展示网络返回的首页。 */ }
}
