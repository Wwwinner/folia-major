import type { FanjiaoAlbum, FanjiaoRecommendation } from '../contracts';
import { albumDto } from './catalog';
import type { FanjiaoClient } from './client';
import { invalid, record, type FanjiaoRecord } from './normalize';
import { featuredPlaylists } from './playlists';

// sources/fanjiao/main/recommendations.ts
// 饭角推荐：首页两个已核验的专辑播放列表在前，随后是已核验推荐模块的专辑；
// 按上游顺序去重并按上限截断，广告外链、播客等不进入结果。

const HOME_PAGE_SIZE = 20;
const MAX_PAGES = 3;
const MAX_RECOMMENDATIONS = 50;

const isAlbumId = (value: unknown): boolean => (
    (typeof value === 'string' || typeof value === 'number') && /^[1-9]\d{0,14}$/.test(String(value))
);

// 首页主轮播只接已核验的专辑跳转；顶层 album_id 通常为 0，实际身份取 extras/link。外链和其他目标一律丢弃。
function bannerAlbum(value: FanjiaoRecord): FanjiaoAlbum | null {
    if (value.type !== 'album') return null;
    try {
        let target: FanjiaoRecord;
        if (value.extras && typeof value.extras === 'object') target = record(value.extras);
        else if (typeof value.link === 'string') target = record(JSON.parse(value.link));
        else return null;
        if (target.path !== '/index/drama_info') return null;
        if (typeof value.title !== 'string' || !value.title.trim()) return null;
        const params = record(target.params);
        if (!isAlbumId(params.album_id)) return null;
        // This banner's cover has no catalogue aspect label; use it only as the default.
        return albumDto({ album_id: params.album_id, name: value.title, cover_url: value.cover });
    } catch { return null; }
}

// A banner can introduce an album before a catalogue module supplies its artwork. Keep the first item and fill only missing shapes.
function addRecommendationAlbum(albums: Map<string, FanjiaoAlbum>, album: FanjiaoAlbum, limit: number) {
    const first = albums.get(album.id);
    if (!first) {
        if (albums.size < limit) albums.set(album.id, album);
        return;
    }
    const incoming = album.coverVariants;
    if (!incoming) return;
    const existing = first.coverVariants;
    const landscape = existing?.landscape ?? incoming.landscape;
    const portrait = existing?.portrait ?? incoming.portrait;
    const square = existing?.square ?? incoming.square;
    if (landscape !== existing?.landscape || portrait !== existing?.portrait || square !== existing?.square) {
        albums.set(album.id, { ...first, coverVariants: { landscape, portrait, square } });
    }
}

/** The albums of one checked home page, in upstream order; malformed and unsupported modules are skipped. */
export function recommendationAlbums(data: FanjiaoRecord): FanjiaoAlbum[] {
    const modules = data.list;
    if (!Array.isArray(modules)) throw new Error('Invalid Fanjiao recommendations');
    const albums = new Map<string, FanjiaoAlbum>();
    for (const moduleRaw of modules) {
        const module = record(moduleRaw);
        if (!Array.isArray(module.list)) continue;
        const banners = Number(module.type) === 1 && Number(module.modular_style) === 2;
        for (const entryRaw of module.list) {
            const entry = record(entryRaw);
            const album = banners ? bannerAlbum(entry) : (isAlbumId(entry.album_id) ? albumDto(entry) : null);
            if (album) addRecommendationAlbum(albums, album, Infinity);
        }
    }
    return [...albums.values()];
}

/** Validate the count at the RPC boundary; an omitted limit uses one page’s worth of results. */
export function recommendationLimit(value: unknown): number {
    if (value === undefined) return 20;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_RECOMMENDATIONS) {
        throw invalid('Invalid Fanjiao recommendation limit');
    }
    return value;
}

// One verified home page is 20 modules; more pages are read only while the limit needs them.
// Playlist cards come from page 1 and count against the same limit as the albums after them.
export async function fetchRecommendedCollections(client: FanjiaoClient, limit: number): Promise<FanjiaoRecommendation[]> {
    const items: FanjiaoRecommendation[] = [];
    const albums = new Map<string, FanjiaoAlbum>();
    for (let page = 1; page <= MAX_PAGES && items.length + albums.size < limit; page++) {
        const data = await client.get('/walkman/api/recommend/home/limit',
            { page, size: HOME_PAGE_SIZE, is_teen: 0, tab_id: 1 });
        const paging = record(data.paging);
        const total = paging.total;
        if (Number(paging.page) !== page || Number(paging.page_size) !== HOME_PAGE_SIZE
            || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
            throw new Error('Invalid Fanjiao recommendation pagination');
        }
        if (page === 1) items.push(...featuredPlaylists(data).slice(0, limit));
        if (items.length >= limit) break;
        for (const album of recommendationAlbums(data)) {
            addRecommendationAlbum(albums, album, limit - items.length);
        }
        if (page * HOME_PAGE_SIZE >= total) break;
    }
    return [...items, ...albums.values()];
}
