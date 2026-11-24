import type { FoliumSourceLyricsResult } from '@folia/folium';
import { record } from './normalize';

// sources/fanjiao/main/subtitles.ts
// 饭角句级字幕归一化；保留明确结束时间、重叠行和原文换行。
//
// 交 VTT 会丢东西：宿主的 VTT 解析器（src/utils/lyrics/parserCore.ts 的 stripVttCueText）把每条
// cue 内的空白折成一个空格，原文里的换行就没了。`.fia` 是 Folia 自己的歌词信封，宿主对音源轨
// 直接 parseFoliaLyricDocument，起止时间、重叠和 fullText 原样保留，所以这里用 `folia` 轨。

export interface FanjiaoSubtitleLine {
    id: string;
    fullText: string;
    startTime: number;
    endTime: number;
    words: never[];
}

export interface ParsedFanjiaoSubtitles {
    lyrics: { lines: FanjiaoSubtitleLine[] };
    invalidCount: number;
}

export function parseSubtitleTime(value: unknown): number {
    if (typeof value !== 'string' || !/^\d+:\d{1,2}:\d{1,2}(?::\d{1,3})?$/.test(value)) {
        throw new Error('Invalid subtitle time');
    }
    const [hours, minutes, seconds, millis = 0] = value.split(':').map(Number);
    if (minutes >= 60 || seconds >= 60) throw new Error('Invalid subtitle clock');
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseFanjiaoSubtitles(document: unknown, audioId: string): ParsedFanjiaoSubtitles {
    const content = record(document).content;
    if (!Array.isArray(content)) throw new Error('Subtitle response has no cue list');
    let invalidCount = 0;
    const lines = content.flatMap((cueRaw, index): FanjiaoSubtitleLine[] => {
        try {
            const cue = record(cueRaw);
            if (typeof cue.content !== 'string' || !cue.content.trim()) return [];
            const startTime = parseSubtitleTime(cue.newStart || cue.startTime);
            const endTime = parseSubtitleTime(cue.newEnd || cue.endTime);
            if (endTime < startTime) throw new Error('Reversed subtitle interval');
            return [{ id: `fanjiao:${audioId}:${index}`, fullText: cue.content.trim(),
                startTime, endTime, words: [] }];
        } catch { invalidCount += 1; return []; }
    }).sort((left, right) => left.startTime - right.startTime);
    if (!lines.length) throw new Error('No valid subtitle cues');
    return { lyrics: { lines }, invalidCount };
}

const LYRIC_TEXT_LIMIT = 1_048_576;

/** A parsed subtitle document as the host reads a source's own `folia` track. */
export function createFanjiaoLyrics(
    audioId: string,
    parsed: ParsedFanjiaoSubtitles,
    now: () => number = Date.now,
): FoliumSourceLyricsResult {
    const document = {
        format: 'folia-lyricdata',
        version: 1,
        exportedAt: new Date(now()).toISOString(),
        song: { key: `fanjiao:${audioId}` },
        source: 'online',
        lyrics: { lines: parsed.lyrics.lines, isWordByWord: false },
    };
    const text = JSON.stringify(document);
    if (text.length > LYRIC_TEXT_LIMIT) throw new Error('Fanjiao subtitles exceed the lyrics limit');
    return { main: { format: 'folia', text } };
}
