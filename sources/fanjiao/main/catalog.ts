import type { FanjiaoAlbum, FanjiaoEpisode } from '../contracts';
import { number, text, type FanjiaoRecord } from './normalize';

// sources/fanjiao/main/catalog.ts
// 饭角目录 DTO 白名单；不把播放授权、上游媒体 URL 或账号字段带过 RPC。

export function requireId(value: unknown): string {
    const id = typeof value === 'string' ? value
        : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
    if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('Invalid Fanjiao media ID');
    return id;
}

const cover = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
};

const playCount = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
);

export function albumDto(raw: FanjiaoRecord): FanjiaoAlbum {
    const square = cover(raw.square);
    const portrait = cover(raw.cover);
    const landscape = cover(raw.horizontal);
    return { id: requireId(raw.album_id), name: text(raw.name || raw.title),
        coverUrl: square || portrait || cover(raw.cover_url) || landscape,
        ...(square || portrait || landscape ? {
            coverVariants: { square: square || undefined, portrait: portrait || undefined, landscape: landscape || undefined },
        } : {}),
        description: text(raw.description),
        author: text(raw.author_name), publisher: text(raw.up_name),
        playCount: playCount(raw.play),
    };
}

export function episodeDto(raw: FanjiaoRecord, album?: FanjiaoAlbum): FanjiaoEpisode {
    const positive = raw.is_positive;
    return { id: requireId(raw.audio_id), albumId: requireId(raw.album_id || album?.id),
        isPositive: positive === 1 || positive === 2 ? positive : null,
        playCount: playCount(raw.play),
        name: text(raw.name), durationMs: Math.max(0, number(raw.duration)) * 1000,
        albumName: album?.name || text(raw.album_name), coverUrl: album?.coverUrl || cover(raw.cover),
        author: album?.author || text(raw.author_name),
    };
}

// 元数据标记不代表媒体访问结果；这里只检查能否发起 VOD 解析，实际可播性由上游请求确认。
export function hasEpisodeMediaAuthorization(raw: FanjiaoRecord): boolean {
    const auth = raw.play_auth;
    const source = raw.encrypt_src;
    return typeof auth === 'string' && auth.trim().length > 0
        && typeof source === 'string' && source.trim().length > 0;
}
