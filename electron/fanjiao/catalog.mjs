// 饭角目录 DTO 白名单；不把播放授权、上游媒体 URL 或账号字段带过 IPC。
export function requireId(value) {
    const id = String(value ?? '');
    if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('Invalid Fanjiao media ID');
    return id;
}

const text = value => typeof value === 'string' ? value : '';
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const cover = value => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
};

export function albumDto(raw) {
    return { id: requireId(raw.album_id), name: text(raw.name),
        coverUrl: cover(raw.square || raw.cover || raw.horizontal), description: text(raw.description),
        author: text(raw.author_name), publisher: text(raw.up_name),
    };
}

export function episodeDto(raw, album) {
    return { id: requireId(raw.audio_id), albumId: requireId(raw.album_id || album?.id),
        isPositive: raw.is_positive === 1 || raw.is_positive === 2 ? raw.is_positive : null,
        playCount: Number.isSafeInteger(raw.play) && raw.play >= 0 ? raw.play : undefined,
        name: text(raw.name), durationMs: Math.max(0, number(raw.duration)) * 1000,
        albumName: album?.name || text(raw.album_name), coverUrl: album?.coverUrl || cover(raw.cover),
        author: album?.author || text(raw.author_name),
    };
}

// 元数据标记不代表媒体访问结果；这里只检查能否发起 VOD 解析，实际可播性由上游请求确认。
export function hasEpisodeMediaAuthorization(raw) {
    return typeof raw.play_auth === 'string' && raw.play_auth.trim().length > 0
        && typeof raw.encrypt_src === 'string' && raw.encrypt_src.trim().length > 0;
}
