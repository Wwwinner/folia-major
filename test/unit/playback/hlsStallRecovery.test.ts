import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHlsStallRecovery } from '../../../src/components/app/playback/hlsStallRecovery';

// 故障时钟可控，核对无声停滞的恢复及暂停/拖动/切源时的用户意图。
function fixture(ranges: number[][] = [[90, 120]]) {
    vi.useFakeTimers();
    const media = Object.assign(new EventTarget(), { currentTime: 100, paused: false, ended: false,
        seeking: false, readyState: 3, error: null, playbackRate: 1,
        buffered: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] },
    });
    const restartLoad = vi.fn(), onFatal = vi.fn();
    const dispose = createHlsStallRecovery(media as unknown as HTMLAudioElement, { restartLoad, onFatal, now: Date.now });
    return { media, restartLoad, onFatal, dispose };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('HLS stalled playback recovery', () => {
    it('lets a slow local fragment finish before reload and bounds the second wait', () => {
        vi.useFakeTimers();
        const media = Object.assign(new EventTarget(), { currentTime: 0, paused: false, ended: false,
            readyState: 0, error: null, playbackRate: 1, buffered: { length: 0 } });
        const restartLoad = vi.fn(), onFatal = vi.fn();
        const dispose = createHlsStallRecovery(media as unknown as HTMLAudioElement,
            { restartLoad, onFatal, now: Date.now, networkWaitMs: 65000 });
        vi.advanceTimersByTime(60000);
        expect(restartLoad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5000);
        expect(restartLoad).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(64000);
        expect(onFatal).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(onFatal).toHaveBeenCalledOnce();
        dispose();
    });
    it('bounds the initial no-metadata wait and refreshes if the first segment never arrives', () => {
        const { media, restartLoad, onFatal } = fixture([]);
        media.currentTime = 0;
        media.readyState = 0;
        media.dispatchEvent(new Event('seeking'));
        vi.advanceTimersByTime(24000);
        expect(restartLoad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(restartLoad).toHaveBeenCalledWith(0);
        vi.advanceTimersByTime(20000);
        expect(onFatal).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(60000);
        expect(onFatal).toHaveBeenCalledOnce();
    });
    it('nudges a frozen buffered playhead once, then escalates once if it still cannot advance', () => {
        const { media, onFatal, restartLoad } = fixture();
        vi.advanceTimersByTime(10000);
        expect(media.currentTime).toBe(100.05);
        expect(restartLoad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(20000);
        expect(onFatal).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60000);
        expect(onFatal).toHaveBeenCalledTimes(1);
    });
    it('restarts loading at the current position when buffer is empty, without skipping speech', () => {
        const { media, restartLoad } = fixture([]);
        vi.advanceTimersByTime(10000);
        expect(restartLoad).toHaveBeenCalledWith(100);
        expect(media.currentTime).toBe(100);
    });
    it('only crosses tiny buffer gaps', () => {
        const small = fixture([[100.2, 120]]);
        vi.advanceTimersByTime(10000);
        expect(small.media.currentTime).toBeCloseTo(100.21);
        small.dispose();
        const large = fixture([[103, 120]]);
        vi.advanceTimersByTime(10000);
        expect(large.media.currentTime).toBe(100);
        expect(large.restartLoad).toHaveBeenCalledOnce();
    });
    it('does not mistake actual progress or repeated waiting events for a permanent stall', () => {
        const { media, onFatal, restartLoad } = fixture();
        for (let i = 0; i < 60; i++) {
            media.currentTime += 1;
            media.dispatchEvent(new Event('waiting'));
            vi.advanceTimersByTime(1000);
        }
        expect(onFatal).not.toHaveBeenCalled();
        expect(restartLoad).not.toHaveBeenCalled();
        expect(media.currentTime).toBe(160);
    });
    it('cancels escalation when playback recovers', () => {
        const { media, onFatal } = fixture();
        vi.advanceTimersByTime(10000);
        for (let i = 0; i < 30; i++) { media.currentTime += 1; vi.advanceTimersByTime(1000); }
        expect(onFatal).not.toHaveBeenCalled();
    });
    it('does not resume a paused track or interfere with seeking, ending or source cleanup', () => {
        const { media, onFatal, restartLoad, dispose } = fixture();
        media.seeking = true;
        media.dispatchEvent(new Event('seeking'));
        vi.advanceTimersByTime(5000);
        media.seeking = false;
        media.paused = true;
        media.dispatchEvent(new Event('pause'));
        vi.advanceTimersByTime(60000);
        expect(media.currentTime).toBe(100);
        media.paused = false;
        media.dispatchEvent(new Event('play'));
        media.ended = true;
        vi.advanceTimersByTime(60000);
        media.ended = false;
        media.dispatchEvent(new Event('play'));
        dispose();
        vi.advanceTimersByTime(60000);
        expect(onFatal).not.toHaveBeenCalled();
        expect(restartLoad).not.toHaveBeenCalled();
    });
    it('recovers a seek that never completes, while repeated user seeks renew the grace period', () => {
        const { media, restartLoad, onFatal } = fixture([]);
        media.seeking = true;
        for (let i = 0; i < 3; i++) {
            media.currentTime += 20;
            media.dispatchEvent(new Event('seeking'));
            vi.advanceTimersByTime(5000);
        }
        expect(restartLoad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5000);
        expect(restartLoad).toHaveBeenCalledWith(160);
        vi.advanceTimersByTime(20000);
        expect(onFatal).toHaveBeenCalledOnce();
    });
});
