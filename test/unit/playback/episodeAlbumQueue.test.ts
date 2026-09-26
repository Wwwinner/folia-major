import { beforeEach, expect, it, vi } from 'vitest';
import { loadEpisodeAlbumQueue } from '../../../src/services/episodeAlbumQueue';

// 续播必须拿到完整队列，并在取消或切换来源时停止后续播放。
const api = vi.hoisted(() => ({ getCollectionTracks: vi.fn(), getActiveRequestGeneration: vi.fn() }));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: api }));
const album = { providerId: 'fanjiao', id: 'album', name: 'Album', type: 'album' as const };
beforeEach(() => { vi.resetAllMocks(); api.getActiveRequestGeneration.mockReturnValue(1); });

it('loads every page in provider order', async () => {
    api.getCollectionTracks.mockResolvedValueOnce({ items: [{ id: '1' }], hasMore: true, nextOffset: 1 })
        .mockResolvedValueOnce({ items: [{ id: '2' }], hasMore: false, nextOffset: 2 });
    expect(await loadEpisodeAlbumQueue(album)).toEqual([{ id: '1' }, { id: '2' }]);
    expect(api.getCollectionTracks).toHaveBeenLastCalledWith(album, { limit: 100, offset: 1 });
});
it('rejects stalled pagination', async () => {
    api.getCollectionTracks.mockResolvedValue({ items: [], hasMore: true, nextOffset: 0 });
    await expect(loadEpisodeAlbumQueue(album)).rejects.toThrow('Invalid episode pagination');
});
it.each(['abort', 'provider'])('ignores results after %s changes', async kind => {
    const controller = new AbortController();
    api.getCollectionTracks.mockImplementation(async () => {
        if (kind === 'abort') controller.abort();
        else api.getActiveRequestGeneration.mockReturnValue(2);
        return { items: [{ id: '1' }], hasMore: true, nextOffset: 1 };
    });
    await expect(loadEpisodeAlbumQueue(album, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.getCollectionTracks).toHaveBeenCalledTimes(1);
});
