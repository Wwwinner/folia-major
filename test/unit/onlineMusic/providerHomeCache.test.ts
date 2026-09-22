import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFromCache, saveToCache } from '@/services/db';
import { getProviderHomeCacheKey, loadProviderHomeSnapshot, saveProviderHomeSnapshot } from '@/services/onlineMusic/providerHomeCache';
import type { HomeDiscoverySection, OmniPage } from '@/types/onlineMusic';

// 首页缓存只保存公开 DTO，校验 provider、版本、有效期和分页位置。
vi.mock('@/services/db', () => ({ getFromCache: vi.fn(), saveToCache: vi.fn() }));
const page: OmniPage<HomeDiscoverySection> = { items: [{ id: 'home:0', title: '推荐', kind: 'albums',
    items: [{ id: '1', name: '测试剧', type: 'album', providerId: 'fanjiao' }] }], hasMore: true, nextOffset: 20, total: 30 };
const snapshot = () => ({ version: 1, savedAt: Date.now(), page });
beforeEach(() => vi.resetAllMocks());
describe('public discovery snapshot', () => {
    it('persists an atomic provider-scoped first page and preserves pagination', async () => {
        await saveProviderHomeSnapshot('fanjiao', page);
        expect(saveToCache).toHaveBeenCalledWith(getProviderHomeCacheKey('fanjiao'), expect.objectContaining({ version: 1, page }));
        vi.mocked(getFromCache).mockResolvedValue(snapshot());
        await expect(loadProviderHomeSnapshot('fanjiao')).resolves.toEqual(page);
        await expect(loadProviderHomeSnapshot('another')).resolves.toBeNull();
    });
    it.each([
        { version: 0 }, { savedAt: Date.now() - 25 * 60 * 60 * 1000 }, { savedAt: Infinity },
        { page: { ...page, nextOffset: -1 } }, { page: { ...page, items: [null] } },
        { page: { ...page, items: [{ ...page.items[0], banners: [{}] }] } },
    ])('rejects an unusable cache snapshot (%j)', async patch => {
        vi.mocked(getFromCache).mockResolvedValue({ ...snapshot(), ...patch });
        await expect(loadProviderHomeSnapshot('fanjiao')).resolves.toBeNull();
    });
    it('tolerates cache storage failures', async () => {
        vi.mocked(getFromCache).mockRejectedValue(new Error('storage unavailable'));
        vi.mocked(saveToCache).mockRejectedValue(new Error('storage unavailable'));
        await expect(loadProviderHomeSnapshot('fanjiao')).resolves.toBeNull();
        await expect(saveProviderHomeSnapshot('fanjiao', page)).resolves.toBeUndefined();
    });
});
