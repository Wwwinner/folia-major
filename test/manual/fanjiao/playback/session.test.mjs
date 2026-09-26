import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackSession } from './session.mjs';
import { parseFanjiaoSubtitles, parseSubtitleTime } from './subtitles.mjs';

// 离线验证刷新并发、重试上限和字幕边界；不连接饭角或读取真实凭据。
function fixture() {
    const calls = { api: 0, media: 0, segments: 0 };
    let now = 0;
    const payload = { audio_id: 120361, album_id: 111726, price: 0, is_public: 1,
        duration: 47, auth_timeout: 3000, name: 'Fixture', subtitle: 'https://static.rela.me/test.json' };
    const client = { get: async () => { calls.api += 1; return payload; } };
    const session = createPlaybackSession(client, {
        now: () => now,
        resolveMedia: async () => {
            calls.media += 1;
            return { url: 'https://play-offline.fanjiao.co/test/index.m3u8', key: null,
                metadata: { definition: 'FD' } };
        },
        readAsset: async url => {
            if (url.endsWith('.m3u8')) return Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:47\n#EXTINF:47,\n0.ts\n#EXT-X-ENDLIST\n');
            if (url.endsWith('.json')) return Buffer.from(JSON.stringify({ content: [
                { content: 'Fixture', newStart: '0:00:00:000', newEnd: '0:00:01:000' },
            ] }));
            calls.segments += 1;
            throw Object.assign(new Error('Media HTTP 403'), { status: 403 });
        },
    });
    return { session, calls, setNow: value => { now = value; } };
}

test('concurrent preparation shares one authorization and media resolution', async () => {
    const { session, calls } = fixture();
    await Promise.all([session.snapshot(), session.playlist(), session.snapshot()]);
    assert.deepEqual(calls, { api: 1, media: 1, segments: 0 });
    assert.equal(session.stats().generations, 1);
});

test('local expiration refreshes once and keeps subtitle timing', async () => {
    const { session, calls, setNow } = fixture();
    await session.snapshot();
    setNow(3000000);
    const snapshot = await session.snapshot();
    await session.playlist();
    assert.equal(calls.api, 2);
    assert.equal(session.stats().lastRefreshReason, 'local-expiry');
    assert.equal(snapshot.lyrics.lines[0].endTime, 1);
});

test('persistent media rejection refreshes once and does not loop or cache failure', async () => {
    const { session, calls } = fixture();
    await assert.rejects(session.segment(0), /Media HTTP 403/);
    assert.deepEqual(calls, { api: 2, media: 2, segments: 2 });
    assert.equal(session.stats().refreshes, 1);
    assert.equal(session.stats().cachedSegments, 0);
});

test('subtitle milliseconds are literal; overlaps remain and reversed intervals are skipped', () => {
    assert.equal(parseSubtitleTime('01:02:03:45'), 3723.045);
    const parsed = parseFanjiaoSubtitles({ content: [
        { content: 'B', newStart: '0:00:01:000', newEnd: '0:00:03:000' },
        { content: 'A', newStart: '0:00:00:045', newEnd: '0:00:02:000' },
        { content: 'Invalid', newStart: '0:00:04:000', newEnd: '0:00:03:000' },
    ] }, 120361);
    assert.equal(parsed.invalidCount, 1);
    assert.deepEqual(parsed.lyrics.lines.map(line => [line.fullText, line.startTime, line.endTime, line.words]),
        [['A', .045, 2, []], ['B', 1, 3, []]]);
});
