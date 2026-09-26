// 饭角句级字幕归一化为 Folia LyricData；保留明确结束时间及重叠行。
export function parseSubtitleTime(value) {
    if (typeof value !== 'string' || !/^\d+:\d{1,2}:\d{1,2}(?::\d{1,3})?$/.test(value)) {
        throw new Error('Invalid subtitle time');
    }
    const [hours, minutes, seconds, millis = 0] = value.split(':').map(Number);
    if (minutes >= 60 || seconds >= 60) throw new Error('Invalid subtitle clock');
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseFanjiaoSubtitles(document, audioId) {
    if (!Array.isArray(document?.content)) throw new Error('Subtitle response has no cue list');
    let invalidCount = 0;
    const lines = document.content.flatMap((cue, index) => {
        try {
            if (!cue || typeof cue.content !== 'string' || !cue.content.trim()) return [];
            const startTime = parseSubtitleTime(cue.newStart || cue.startTime);
            const endTime = parseSubtitleTime(cue.newEnd || cue.endTime);
            if (endTime < startTime) throw new Error('Reversed subtitle interval');
            return [{ id: `fanjiao:${audioId}:${index}`, fullText: cue.content.trim(),
                startTime, endTime, words: [] }];
        } catch { invalidCount += 1; return []; }
    }).sort((a, b) => a.startTime - b.startTime);
    if (!lines.length) throw new Error('No valid subtitle cues');
    return { lyrics: { lines }, invalidCount };
}
