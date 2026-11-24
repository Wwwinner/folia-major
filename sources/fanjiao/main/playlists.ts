import type { FanjiaoAlbum, FanjiaoPage, FanjiaoPlaylist } from '../contracts';
import { albumDto } from './catalog';
import type { FanjiaoClient } from './client';
import { invalid, record, text, type FanjiaoRecord } from './normalize';

// sources/fanjiao/main/playlists.ts
// 首页「热门速递」「精品周更」是官方推荐模块，打开时才按固定 type 读取 major 列表；
// 这里只产出专辑和专辑播放列表，不读取分集、不经过账号接口。

export const FEATURED_PLAYLISTS = {
    'featured:popular': { name: '热门速递', type: 1 },
    'featured:weekly': { name: '精品周更', type: 3 },
} as const;

export type FeaturedPlaylistId = keyof typeof FEATURED_PLAYLISTS;

const PLAYLIST_IDS = Object.keys(FEATURED_PLAYLISTS) as FeaturedPlaylistId[];
const MAJOR_PATH = '/walkman/api/recommend/major';
const MAJOR_PAGE_SIZE = 20;
const MAX_PLAYLIST_LIMIT = 100;

const isFeaturedId = (value: string): value is FeaturedPlaylistId => Object.hasOwn(FEATURED_PLAYLISTS, value);

/** Only the two checked playlists open; every other id, including an album id, is a bad request. */
export function featuredPlaylistId(value: unknown): FeaturedPlaylistId {
    if (typeof value !== 'string' || !isFeaturedId(value)) throw invalid('Invalid Fanjiao playlist');
    return value;
}

export function playlistLimit(value: unknown): number {
    if (value === undefined) return 50;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PLAYLIST_LIMIT) {
        throw invalid('Invalid Fanjiao playlist limit');
    }
    return value;
}

export function playlistOffset(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0
        || value > Number.MAX_SAFE_INTEGER - MAX_PLAYLIST_LIMIT) {
        throw invalid('Invalid Fanjiao playlist offset');
    }
    return value;
}

// The home module points at the major list through request_extras; the path and the numeric type are
// the official identity of the two checked lists. modular_name is the upstream display name for the card.
function isFeaturedModule(module: FanjiaoRecord, id: FeaturedPlaylistId): boolean {
    const extras = record(module.request_extras);
    if (extras.path !== '/recommend/major') return false;
    return Number(record(extras.params).type) === FEATURED_PLAYLISTS[id].type;
}

function firstPreviewAlbum(list: unknown): FanjiaoAlbum | null {
    if (!Array.isArray(list)) return null;
    for (const entry of list) {
        try { return albumDto(record(entry)); } catch { /* a malformed child is not a cover source */ }
    }
    return null;
}

/**
 * The two playlist cards the home payload actually offers. A card needs a matching official module
 * with at least one real album; repeated modules make one card, in the fixed popular-then-weekly order.
 */
export function featuredPlaylists(data: FanjiaoRecord): FanjiaoPlaylist[] {
    const modules = data.list;
    if (!Array.isArray(modules)) throw new Error('Invalid Fanjiao recommendations');
    const cards: FanjiaoPlaylist[] = [];
    for (const id of PLAYLIST_IDS) {
        for (const moduleRaw of modules) {
            const module = record(moduleRaw);
            if (!isFeaturedModule(module, id)) continue;
            const first = firstPreviewAlbum(module.list);
            if (!first) continue;
            cards.push({
                kind: 'playlist', id, name: text(module.modular_name).trim() || FEATURED_PLAYLISTS[id].name,
                coverUrl: first.coverUrl, coverVariants: first.coverVariants, playlistContents: 'albums',
            });
            break;
        }
    }
    return cards;
}

/**
 * A raw-offset page of a checked playlist's albums. Only the official 20-row pages that intersect
 * `[offset, offset + limit)` are read; each is sliced to its overlap before malformed rows are skipped.
 * `nextOffset` and `hasMore` follow upstream rows, so the UI can ask for the next stretch even when
 * this page yielded fewer unique albums. Total is omitted: upstream counts rows, not unique albums.
 */
export async function fetchPlaylistAlbums(
    client: FanjiaoClient,
    idValue: unknown,
    limitValue: unknown,
    offsetValue: unknown,
): Promise<FanjiaoPage<FanjiaoAlbum>> {
    const id = featuredPlaylistId(idValue);
    const limit = playlistLimit(limitValue);
    const offset = playlistOffset(offsetValue);
    const type = FEATURED_PLAYLISTS[id].type;
    const firstPage = Math.floor(offset / MAJOR_PAGE_SIZE) + 1;
    const lastPage = Math.floor((offset + limit - 1) / MAJOR_PAGE_SIZE) + 1;
    const items: FanjiaoAlbum[] = [];
    const seen = new Set<string>();
    let total = 0;
    let nextOffset = offset;
    for (let page = firstPage; page <= lastPage; page++) {
        const data = await client.get(MAJOR_PATH, { page, size: MAJOR_PAGE_SIZE, type });
        const paging = record(data.paging);
        const pageTotal = paging.total;
        if (Number(paging.page) !== page || Number(paging.page_size) !== MAJOR_PAGE_SIZE
            || typeof pageTotal !== 'number' || !Number.isSafeInteger(pageTotal) || pageTotal < 0) {
            throw new Error('Invalid Fanjiao playlist pagination');
        }
        total = pageTotal;
        const pageStart = (page - 1) * MAJOR_PAGE_SIZE;
        if (pageStart >= total) break;
        const list = data.list;
        if (!Array.isArray(list)) throw new Error('Invalid Fanjiao playlist');
        const from = Math.max(offset - pageStart, 0);
        const pageEnd = Math.min(offset + limit, pageStart + MAJOR_PAGE_SIZE, total);
        const to = Math.min(pageEnd - pageStart, list.length);
        for (let index = from; index < to; index++) {
            try {
                const album = albumDto(record(list[index]));
                if (seen.has(album.id)) continue;
                seen.add(album.id);
                items.push(album);
            } catch { /* skip a malformed album and keep the upstream order of the rest */ }
        }
        nextOffset = Math.max(nextOffset, pageEnd);
        if (pageEnd >= total) break;
    }
    return { items, hasMore: nextOffset < total, nextOffset };
}
