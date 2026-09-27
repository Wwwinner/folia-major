import { describe, expect, it } from 'vitest';
import { ZERO_VERSION, mergeFanjiaoHistory, parseFanjiaoSyncData, parseEpisodeValue } from '../../../shared/fanjiaoSync.mjs';
import type { FanjiaoRecord, SyncVersion } from '../../../shared/fanjiaoSync.mjs';

// Fences protect explicit restart/delete/clear operations from delayed offline progress.
const v = (counter: number, device = 'a'): SyncVersion => ({ counter, device });
const value = { position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90 };
const row = (key = 'online:fanjiao:1', version = v(1), generation = ZERO_VERSION): FanjiaoRecord =>
    ({ key, version, generation, epoch: ZERO_VERSION, deleted: false, value });
const history = (...records: FanjiaoRecord[]) => ({ epoch: ZERO_VERSION, records });

describe('Fanjiao protocol', () => {
    it('merges different episodes and converges for retries, shuffled arrivals and equal clocks', () => {
        const a = history(row(), row('online:fanjiao:2'));
        const b = history({ ...row(undefined, v(1, 'b')), value: { ...value, position: 20 } });
        const merged = mergeFanjiaoHistory(a, b);
        expect(merged).toEqual(mergeFanjiaoHistory(b, a));
        expect(mergeFanjiaoHistory(merged, a)).toEqual(merged);
        expect(merged.records[0].value?.position).toBe(20);
        expect(merged.records).toHaveLength(2);
    });
    it('lets restart supersede completed or higher-position progress even when old progress arrives later', () => {
        const restart = { ...row(undefined, v(4), v(3)), value: { ...value, position: 0 } };
        const stale = { ...row(undefined, v(9000, 'offline')), value: { ...value, position: 1200, completed: true } };
        expect(mergeFanjiaoHistory(history(stale), history(restart)).records).toEqual([restart]);
    });
    it('retains deletion until explicit listening creates a new generation', () => {
        const deleted = { ...row(undefined, v(3), v(3)), deleted: true, value: null };
        expect(mergeFanjiaoHistory(history(deleted), history(row(undefined, v(999)))).records).toEqual([deleted]);
        const replay = row(undefined, v(5), v(4));
        expect(mergeFanjiaoHistory(history(deleted), history(replay)).records).toEqual([replay]);
    });
    it('propagates clear without retaining individual tombstones or accepting an older epoch', () => {
        const clear = { epoch: v(5), records: [] };
        expect(mergeFanjiaoHistory(clear, history(row(undefined, v(999))))).toEqual(clear);
        const replay = { ...row(undefined, v(6)), epoch: v(5) };
        expect(mergeFanjiaoHistory(clear, { epoch: v(5), records: [replay] }).records).toEqual([replay]);
    });
    it('only serializes display fields and removes private cover references', () => {
        const metadata = { name: 'Episode', albumId: '7', albumName: 'Drama', author: 'Studio', kind: 'main',
            coverUrl: 'https://images.example.com/cover.jpg?token=secret', playAuth: 'secret' };
        const parsed = parseEpisodeValue({ ...value, metadata, mediaUrl: 'private', credential: 'secret' });
        expect(JSON.stringify(parsed)).not.toMatch(/secret|private|token|playAuth|mediaUrl|credential/);
        expect(parsed?.metadata?.coverUrl).toBe('https://images.example.com/cover.jpg');
        expect(parseEpisodeValue({ ...value, metadata: { ...metadata, coverUrl: 'http://127.0.0.1/cover.jpg' } })?.metadata?.coverUrl).toBe('');
    });
    it('rejects malformed nested data, unrelated providers, duplicated keys and oversized batches', () => {
        expect(parseFanjiaoSyncData({ protocol: 1, history: history({ ...row(), key: 'online:other:1' }) })).toBeNull();
        expect(parseFanjiaoSyncData({ protocol: 1, history: history({ ...row(), value: { ...value, position: NaN } }) })).toBeNull();
        expect(parseFanjiaoSyncData({ protocol: 1, history: history(row(), row()) })).toBeNull();
        expect(parseFanjiaoSyncData({ protocol: 1, history: history(row(), row('online:fanjiao:2')) }, 1)).toBeNull();
        expect(parseFanjiaoSyncData({ protocol: 1, preference: { version: v(1), mainOnly: 'false' } })).toBeNull();
    });
});
