const { app, net } = require('electron');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

// 分段测量生产链路，并用独立 net.fetch 比较首页；仅输出耗时和大小，不落盘授权或媒体地址。
const root = process.cwd();
const episodeId = process.argv.find(value => /^--episode=\d+$/.test(value))?.split('=')[1] || '120484';
const output = path.join(root, 'test-results/fanjiao-latency');
app.setPath('userData', path.join(output, `profile-${process.pid}`));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
app.whenReady().then(async () => {
    const load = name => import(pathToFileURL(path.join(root, 'electron/fanjiao', name)).href);
    const { createFanjiaoClient, signFanjiaoGet } = await load('client.mjs');
    const { createFanjiaoService, readSigningSecret } = await load('service.mjs');
    const { createPlaybackSession, readMediaAsset, getEpisodeLyrics } = await load('session.mjs');
    const { resolveVod } = await load('vod.mjs');
    const { createEpisodeInfoCache } = await load('episodeInfoCache.mjs');
    const secret = readSigningSecret({ appPath: root, userData: output, isDev: true });
    if (!secret) throw new Error('Signing credential unavailable');
    const nodeFetch = globalThis.fetch.bind(globalThis);
    const reports = [];
    for (const transport of ['node']) {
        const stages = [];
        const timed = async (stage, work) => {
            const start = performance.now();
            try {
                const value = await work();
                stages.push({ stage, ms: Math.round(performance.now() - start), ok: true,
                    ...(Buffer.isBuffer(value) ? { bytes: value.length } : {}) });
                return value;
            } catch (error) {
                stages.push({ stage, ms: Math.round(performance.now() - start), ok: false, error: error.name });
                throw error;
            }
        };
        const client = createFanjiaoClient(secret);
        const measuredClient = { get: (route, params, signal) => timed(`api:${route.split('/').slice(-2).join('/')}`,
            () => client.get(route, params, signal)) };
        const service = createFanjiaoService({ client: measuredClient });
        const sharedClient = createEpisodeInfoCache(measuredClient);
        const media = createPlaybackSession(sharedClient, episodeId, {
            resolveMedia: (...args) => timed('vod', () => resolveVod(...args)),
            readAsset: (...args) => timed(new URL(args[0]).pathname.endsWith('.m3u8') ? 'manifest' : 'segment-download', () => readMediaAsset(...args)),
        });
        try {
            const home = await timed('home-cold', () => service.request('homeSections', { limit: 20, offset: 0 })).catch(() => null);
            await timed('home-warm', () => service.request('homeSections', { limit: 20, offset: 0 })).catch(() => {});
            const images = home?.items.flatMap(section => section.banners?.slice(0, 1).map(b => b.imageUrl)
                ?? section.items.slice(0, 1).map(album => album.coverUrl)).filter(Boolean).slice(0, 3) ?? [];
            await Promise.allSettled(images.map((url, index) => timed(`image-${index}`, async () => {
                const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
                if (!response.ok) throw new Error('Image unavailable');
                return Buffer.from(await response.arrayBuffer());
            })));
            const start = performance.now();
            // 正式播放器先取得 source，再把首片加载与字幕请求并行发起。
            await timed('source-ready', () => media.source());
            await Promise.allSettled([
                (async () => {
                    await timed('first-segment-ready', () => media.segment(0));
                    stages.push({ stage: 'source-and-first-segment', ms: Math.round(performance.now() - start), ok: true });
                    await timed('prefetched-first-segment-hit', () => media.segment(0));
                    await timed('second-segment-ready', () => media.segment(1));
                })(),
                timed('lyrics-ready', () => getEpisodeLyrics(sharedClient, episodeId)),
            ]);
        } catch { /* 失败已由 timed 记录，继续比较下一种网络栈。 */ }
        finally { media.dispose(); service.dispose(); sharedClient.clear(); }
        reports.push({ transport, stages });
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, 'latency-optimized.json'), JSON.stringify(reports, null, 2));
        console.log(JSON.stringify(reports.at(-1)));
    }
    // net.fetch 自身可能依赖全局 fetch；不能把全局 fetch 改成 net.fetch 来进行比较。
    const params = { page: 1, size: 20, is_teen: 0, tab_id: 1 };
    const started = performance.now();
    let stage;
    try {
        const response = await net.fetch(`https://api.fanjiao.co/walkman/api/recommend/home/limit?${new URLSearchParams(params)}`, {
            headers: { signature: signFanjiaoGet(params, secret), 'user-agent': 'fanjiao/3.15.1 140 Android 15' },
            redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        const value = await response.json();
        stage = { stage: 'home-api', ms: Math.round(performance.now() - started), ok: response.ok && Number(value.code) === 0 };
    } catch (error) { stage = { stage: 'home-api', ms: Math.round(performance.now() - started), ok: false, error: error.name }; }
    reports.push({ transport: 'chromium', stages: [stage] });
    await writeFile(path.join(output, 'latency-optimized.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports.at(-1)));
    globalThis.fetch = nodeFetch;
}).catch(error => { console.error('Latency probe failed:', error.name); process.exitCode = 1; }).finally(() => app.quit());
