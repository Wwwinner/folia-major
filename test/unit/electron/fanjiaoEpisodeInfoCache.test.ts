import { describe, expect, it, vi } from 'vitest';
import { createEpisodeInfoCache } from '../../../electron/fanjiao/episodeInfoCache.mjs';
import { createPlaybackSession } from '../../../electron/fanjiao/session.mjs';

// 分集详情共享不能把旧授权复用于强制刷新，也不能让一个取消的消费者中止另一个消费者。
const route = '/walkman/api/audio/info';
const params = { audio_id: '1' };
const payload = { audio_id: '1', auth_timeout: 3000, subtitle: 'fixture' };
describe('Fanjiao shared episode detail', () => {
    it('merges concurrent requests, reuses recent metadata and expires it', async () => {
        let clock = 0;
        const get = vi.fn(async () => payload);
        const cache = createEpisodeInfoCache({ get }, { now: () => clock });
        const result = await Promise.all([cache.get(route, params), cache.get(route, params)]);
        expect(result).toEqual([payload, payload]); expect(get).toHaveBeenCalledOnce();
        await cache.get(route, params); expect(get).toHaveBeenCalledOnce();
        clock = 10001;
        await cache.get(route, params); expect(get).toHaveBeenCalledTimes(2);
        cache.clear();
    });
    it('forces new authorization while publishing it for following subtitle reads', async () => {
        const get = vi.fn().mockResolvedValueOnce({ ...payload, generation: 1 }).mockResolvedValueOnce({ ...payload, generation: 2 });
        const cache = createEpisodeInfoCache({ get });
        await cache.get(route, params);
        expect(await cache.get(route, params, undefined, { fresh: true })).toMatchObject({ generation: 2 });
        expect(await cache.get(route, params)).toMatchObject({ generation: 2 });
        expect(get).toHaveBeenCalledTimes(2); cache.clear();
    });
    it('lets one subscriber abort without cancelling another', async () => {
        let complete!: (value: unknown) => void;
        const get = vi.fn((_route, _params, signal) => new Promise(resolve => { complete = resolve; }));
        const cache = createEpisodeInfoCache({ get });
        const a = new AbortController(), b = new AbortController();
        const first = expect(cache.get(route, params, a.signal)).rejects.toMatchObject({ name: 'AbortError' });
        const second = cache.get(route, params, b.signal);
        await Promise.resolve();
        a.abort(); await first;
        expect(get.mock.calls[0][2].aborted).toBe(false);
        complete(payload); await expect(second).resolves.toEqual(payload);
        cache.clear();
    });
    it('aborts shared work when the final subscriber leaves and does not cache failures', async () => {
        const get = vi.fn((_route, _params, signal: AbortSignal) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
        }));
        const cache = createEpisodeInfoCache({ get });
        const controller = new AbortController();
        const request = expect(cache.get(route, params, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        await Promise.resolve(); controller.abort(); await request;
        expect(get.mock.calls[0][2].aborted).toBe(true);
        get.mockImplementation(async () => { throw new Error('temporary'); });
        await expect(cache.get(route, params)).rejects.toThrow('temporary');
        get.mockImplementation(async () => payload);
        await expect(cache.get(route, params)).resolves.toEqual(payload);
        cache.clear();
    });
    it('does not reuse an authorization that is about to expire', async () => {
        const get = vi.fn(async () => ({ ...payload, auth_timeout: 1 }));
        const cache = createEpisodeInfoCache({ get });
        await cache.get(route, params); await cache.get(route, params);
        expect(get).toHaveBeenCalledTimes(2); cache.clear();
    });
    it('does not let an older in-flight response replace a forced refresh', async () => {
        const complete: Array<(value: unknown) => void> = [];
        const get = vi.fn(() => new Promise(resolve => complete.push(resolve)));
        const cache = createEpisodeInfoCache({ get });
        const old = cache.get(route, params);
        const fresh = cache.get(route, params, undefined, { fresh: true });
        await Promise.resolve();
        complete[1]({ ...payload, generation: 2 }); await fresh;
        complete[0]({ ...payload, generation: 1 }); await old;
        expect(await cache.get(route, params)).toMatchObject({ generation: 2 });
        expect(get).toHaveBeenCalledTimes(2); cache.clear();
    });
    it('bypasses cached authorization for new sources and after a segment 403', async () => {
        const get = vi.fn(async () => ({ ...payload, play_auth: 'fixture', encrypt_src: 'fixture' }));
        const cache = createEpisodeInfoCache({ get });
        await cache.get(route, params);
        let reads = 0;
        const session = createPlaybackSession(cache, '1', {
            resolveMedia: async () => ({ url: 'https://play.fanjiao.co/index.m3u8', key: null,
                metadata: { definition: 'FD', format: 'm3u8', duration: 10, size: 7, codec: 'aac', encrypted: false, encryption: null, available: [] } }),
            readAsset: async (url: string) => {
                if (url.endsWith('.m3u8')) return Buffer.from('#EXTM3U\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n');
                if (reads++ === 0) throw Object.assign(new Error('expired'), { status: 403 });
                return Buffer.from('segment');
            },
        });
        try {
            await session.source();
            await expect(session.segment(0)).resolves.toEqual(Buffer.from('segment'));
            expect(get).toHaveBeenCalledTimes(3);
        } finally { session.dispose(); cache.clear(); }
    });
});
