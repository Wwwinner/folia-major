import { albumDto } from './catalog.mjs';
import { fetchRankingPage, isRankingSection, rankedAlbums, rankingSectionId } from './rankings.mjs';

// 饭角发现页：归一化专辑、榜单及专辑横幅，不透传动态路由、广告外链或任意请求。
const FILTER_FIELDS = { category: 'category', style: 'style', completion: 'is_over', price: 'is_buy', sort: 'sort' };
const isAlbum = raw => raw && /^[1-9]\d{0,14}$/.test(String(raw.album_id ?? ''));
const albums = raw => Array.isArray(raw) ? raw.filter(isAlbum).map(albumDto) : [];
// 已核验的普通专辑栏目；播客、CV 和外链不进入这个映射。
const SECTION_ROUTES = new Map([
    ['popular', { endpoint: 'major', type: 1 }],
    ['weekly', { endpoint: 'major', type: 3 }],
    ['audiobooks', { endpoint: 'major', type: 5 }],
    ['discounts', { endpoint: 'special', type: 17 }],
    ['music', { endpoint: 'special', type: 12 }],
    ['new-releases', { endpoint: 'major', type: 4 }],
    ['romance', { endpoint: 'special', type: 5 }],
    ['historical', { endpoint: 'special', type: 3 }],
    ['angst', { endpoint: 'special', type: 7 }],
    ['sweet', { endpoint: 'special', type: 8 }],
    ['scenarios', { endpoint: 'special', type: 15 }],
    ['free', { endpoint: 'special', type: 16 }],
    ['one-shot', { endpoint: 'special', type: 9 }],
]);

function pagination(params, defaultLimit) {
    const limit = params.limit ?? defaultLimit;
    const offset = params.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset)
        || offset < 0 || offset % limit) throw new Error('Invalid Fanjiao discovery page');
    return { limit, offset, page: offset / limit + 1 };
}

function pageDto(data, items, { limit, offset, page }) {
    if (Number(data.paging?.page) !== page || Number(data.paging?.page_size) !== limit
        || !Number.isSafeInteger(data.paging?.total) || data.paging.total < 0) {
        throw new Error('Invalid Fanjiao discovery pagination');
    }
    // 首页 total 计的是上游模块，不能按过滤后的栏目或剧集数量推进分页。
    return { items, total: data.paging.total, hasMore: page * limit < data.paging.total, nextOffset: offset + limit };
}

// 首页主轮播只接已核验的专辑跳转；顶层 album_id 通常为 0，实际身份取 extras/link。
function bannerDto(raw) {
    if (!raw || raw.type !== 'album' || !/^[1-9]\d{0,14}$/.test(String(raw.banner_id ?? ''))) return null;
    try {
        const target = raw.extras && typeof raw.extras === 'object' ? raw.extras : JSON.parse(raw.link);
        if (target.path !== '/index/drama_info') return null;
        const album = albumDto({ album_id: target.params?.album_id, name: raw.title });
        const image = new URL(raw.cover);
        if (image.protocol !== 'https:' || image.username || image.password) return null;
        return { id: String(raw.banner_id), title: album.name, imageUrl: image.href, album };
    } catch { return null; }
}

export function homeSectionsDto(data, paging) {
    if (!Array.isArray(data.list)) throw new Error('Invalid Fanjiao home sections');
    const sections = [];
    data.list.forEach((module, index) => {
        if (!Array.isArray(module.list)) return;
        const id = `home:${paging.offset}:${index}`;
        if (Number(module.type) === 1 && Number(module.modular_style) === 2) {
            const banners = module.list.map(bannerDto).filter(Boolean);
            if (banners.length) sections.push({ id, title: String(module.modular_name || ''), kind: 'banners', items: [], banners });
            return;
        }
        const items = albums(module.list);
        const moreId = [...SECTION_ROUTES].find(([, route]) => module.request_extras?.path === `/recommend/${route.endpoint}`
            && Number(module.request_extras?.params?.type) === route.type)?.[0];
        const layout = moreId === 'weekly' ? 'landscape-grid' : undefined;
        if (items.length) sections.push({ id, title: String(module.modular_name || ''), kind: 'albums', items, moreId, layout });
        module.list.forEach((rank, rankIndex) => {
            const moreId = rankingSectionId(rank.tab);
            const ranked = moreId ? rankedAlbums(rank.rank_list, moreId) : albums(rank.rank_list);
            if (moreId || ranked.length) sections.push({ id: `${id}:rank:${rankIndex}`, title: String(rank.name || ''), kind: 'ranking', items: ranked, moreId });
        });
    });
    return pageDto(data, sections, paging);
}

export function browseFiltersDto(data) {
    return Object.entries(FILTER_FIELDS).map(([key, field]) => {
        if (!Array.isArray(data[field])) throw new Error('Invalid Fanjiao browse filters');
        return { key, options: data[field].filter(item => Number.isSafeInteger(item.id) && item.id >= 0 && typeof item.name === 'string')
            .map(item => ({ value: String(item.id), label: item.name })) };
    });
}

export function createFanjiaoDiscovery(getClient, now = Date.now) {
    const cache = new Map();
    async function fetchResult(operation, params) {
        const client = getClient();
        if (operation === 'browseFilters') return browseFiltersDto(await client.get('/walkman/api/search/classify/filter', {}));
        const paging = pagination(params, operation === 'browseAlbums' ? 24 : 20);
        const query = { page: paging.page, size: paging.limit };
        if (operation === 'homeSections') {
            const data = await client.get('/walkman/api/recommend/home/limit', { ...query, is_teen: 0, tab_id: 1 });
            return homeSectionsDto(data, paging);
        }
        if (operation === 'sectionAlbums') {
            if (isRankingSection(params.id)) return fetchRankingPage(client, params.id, paging);
            // 栏目标识映射到固定接口，不能由界面指定路径或 type。
            const route = SECTION_ROUTES.get(params.id);
            if (!route) throw new Error('Unsupported Fanjiao discovery section');
            const data = await client.get(`/walkman/api/recommend/${route.endpoint}`, { ...query, type: route.type });
            if (!Array.isArray(data.list)) throw new Error('Invalid Fanjiao section albums');
            return pageDto(data, albums(data.list), paging);
        }
        for (const [key, field] of Object.entries(FILTER_FIELDS)) {
            if (params[key] === undefined) continue;
            if (!/^\d{1,8}$/.test(String(params[key]))) throw new Error('Invalid Fanjiao browse filter');
            query[field] = Number(params[key]);
        }
        const data = await client.get('/walkman/api/search/classify/index', query);
        if (!Array.isArray(data.result_data)) throw new Error('Invalid Fanjiao browse results');
        return pageDto(data, albums(data.result_data), paging);
    }
    return {
        request(operation, params) {
            const key = JSON.stringify([operation, params]);
            const entry = cache.get(key);
            if (entry && now() - entry.at < 60000) return entry.value;
            if (cache.size >= 32) cache.delete(cache.keys().next().value);
            const value = fetchResult(operation, params).catch(error => { cache.delete(key); throw error; });
            cache.set(key, { at: now(), value });
            return value;
        },
        clear: () => cache.clear(),
    };
}
