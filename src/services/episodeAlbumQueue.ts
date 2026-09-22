import type { SongResult } from '../types';
import type { OmniCollection } from '../types/onlineMusic';
import { omni } from './onlineMusic/omni';

// 历史和首页续播共用完整专辑队列；切换来源或卸载后停止后续分页。
export async function loadEpisodeAlbumQueue(collection: OmniCollection, signal?: AbortSignal): Promise<SongResult[]> {
    const generation = omni.getActiveRequestGeneration();
    const queue: SongResult[] = [];
    let offset = 0;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        if (signal?.aborted || generation !== omni.getActiveRequestGeneration()) throw new DOMException('Cancelled', 'AbortError');
        const page = await omni.getCollectionTracks(collection, { limit: 100, offset });
        if (signal?.aborted || generation !== omni.getActiveRequestGeneration()) throw new DOMException('Cancelled', 'AbortError');
        queue.push(...page.items);
        if (!page.hasMore) return queue;
        if (page.nextOffset <= offset) throw new Error('Invalid episode pagination');
        offset = page.nextOffset;
    }
    throw new Error('Episode pagination limit reached');
}
