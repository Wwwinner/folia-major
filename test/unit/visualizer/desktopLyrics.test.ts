import { describe, expect, it } from 'vitest';
import { PlayerState } from '../../../src/types';
import type { DesktopLyricsSnapshot } from '../../../src/types/desktopLyrics';
import { desktopLyricsTime } from '../../../src/components/desktop-lyrics/desktopLyricsClock';
import { buildDialogueTimeline, getDialogueSnapshot } from '../../../src/components/visualizer/dialogue/dialogueTimeline';
import { compressConfig, decompressConfig } from '../../../src/utils/appearanceCodec';
import { normalizeDesktopLyricsAppearance } from '../../../src/types/desktopLyrics';

// 独立字幕的时钟、重叠边界及外观备份合同，不依赖真实媒体接口。
const snapshot: DesktopLyricsSnapshot = { hasTrack: true, trackKey: 'fixture', currentTime: 12, duration: 30,
    playerState: PlayerState.PLAYING, playbackRate: 2, isAdvancing: true, lyricOffsetMs: 500, updatedAt: 1 };
describe('desktop subtitle clock and appearance', () => {
    it('respects playback rate and lyric offset, stops on pause or buffer wait, and caps stale extrapolation', () => {
        expect(desktopLyricsTime(snapshot, 500)).toBe(12.5);
        expect(desktopLyricsTime(snapshot, 5000)).toBe(13.5);
        expect(desktopLyricsTime({ ...snapshot, isAdvancing: false }, 500)).toBe(11.5);
        expect(desktopLyricsTime({ ...snapshot, playerState: PlayerState.PAUSED }, 500)).toBe(11.5);
        expect(desktopLyricsTime({ ...snapshot, currentTime: 29.5 }, 1000)).toBe(29.5);
    });
    it('keeps all overlapping lines, excludes future text, and removes ended text on exact boundaries', () => {
        const timeline = buildDialogueTimeline([
            { startTime: 2, endTime: 20, fullText: 'Long', words: [] },
            { startTime: 10, endTime: 15, fullText: 'Overlap', words: [] },
            { startTime: 22, endTime: 25, fullText: 'Future', words: [] },
        ]);
        expect([...getDialogueSnapshot(timeline, 12).active]).toEqual([0, 1]);
        expect([...getDialogueSnapshot(timeline, 15).active]).toEqual([0]);
        expect([...getDialogueSnapshot(timeline, 4).active]).toEqual([0]);
    });
    it('round-trips appearance without exporting window activation, lock or coordinates', () => {
        const config = { desktopLyricsAppearance: { fontSize: 48, glowIntensity: 0, enabled: true, locked: true, x: 400 } };
        expect(decompressConfig(compressConfig(config))).toMatchObject({ desktopLyricsAppearance: { fontSize: 48, glowIntensity: 0 } });
        expect(decompressConfig(compressConfig(config)).desktopLyricsAppearance).not.toHaveProperty('enabled');
        expect(decompressConfig(JSON.stringify({ desktopLyricsAppearance: { fontSize: 44, glowIntensity: 1.5 } })))
            .toEqual({ desktopLyricsAppearance: { fontSize: 44, glowIntensity: 1.5 } });
        expect(normalizeDesktopLyricsAppearance({ fontSize: 999, glowIntensity: -1 })).toEqual({ fontSize: 64, glowIntensity: 0 });
    });
});
