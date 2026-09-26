import { albumDto } from './catalog.mjs';

// 榜单白名单与数据归一化；当前只接入已核验的 time_type=1，不接受总榜或历史参数。
const RANKINGS = new Map([
    ['ranking-feeding', { tab: 2, field: 'feeding', metric: 'feeding' }],
    ['ranking-followers', { tab: 3, field: 'liked', metric: 'followers' }],
    ['ranking-popularity', { tab: 4, field: 'popularity', metric: 'popularity' }],
    ['ranking-new', { tab: 5, field: 'play', metric: 'plays' }],
    ['ranking-free', { tab: 6, field: 'play', metric: 'plays' }],
]);

export const isRankingSection = id => RANKINGS.has(id);
export const rankingSectionId = tab => [...RANKINGS].find(([, config]) => config.tab === Number(tab))?.[0];

export function rankedAlbums(raw, id) {
    const config = RANKINGS.get(id);
    if (!config || !Array.isArray(raw)) return [];
    return raw.filter(item => item && /^[1-9]\d{0,14}$/.test(String(item.album_id ?? ''))
        && Number.isSafeInteger(item.rank) && item.rank > 0).map(item => ({
        ...albumDto(item), ranking: { position: item.rank, metric: config.metric,
            value: Number.isSafeInteger(item[config.field]) && item[config.field] >= 0 ? item[config.field] : undefined },
    }));
}

// 投喂、追剧和人气榜会返回 total=0 但有数据：按原始页长继续，空页/短页结束。
export async function fetchRankingPage(client, id, { limit, offset, page }) {
    const config = RANKINGS.get(id);
    if (!config) throw new Error('Unsupported Fanjiao ranking');
    const data = await client.get('/walkman/api/ranking/album', { tab: config.tab, time_type: 1, page, size: limit });
    if (!Array.isArray(data.list) || Number(data.paging?.page) !== page || Number(data.paging?.page_size) !== limit
        || !Number.isSafeInteger(data.paging?.total) || data.paging.total < 0) throw new Error('Invalid Fanjiao ranking pagination');
    const items = rankedAlbums(data.list, id);
    const total = data.paging.total > 0 && data.paging.total >= offset + data.list.length ? data.paging.total : undefined;
    return { items, total, nextOffset: offset + limit,
        hasMore: items.length > 0 && data.list.length === limit && (total === undefined || offset + data.list.length < total) };
}
