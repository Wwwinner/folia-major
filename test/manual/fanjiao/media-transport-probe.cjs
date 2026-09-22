const { app, net, session } = require('electron');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

// 对同一授权的实际媒体分片做网络栈对照；仅记录耗时/字节/状态，不输出媒体地址或授权。
const root = process.cwd(), output = path.join(root, 'test-results/fanjiao-media-transport');
const proxy = process.argv.find(value => value.startsWith('--proxy='))?.slice('--proxy='.length);
let proxyTransport;
app.setPath('userData', path.join(output, `profile-${process.pid}`));
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
app.whenReady().then(async () => {
    const load = name => import(pathToFileURL(path.join(root, 'electron/fanjiao', name)).href);
    if (proxy) proxyTransport = await (await load('mediaTransport.mjs')).createMediaTransport(proxy, session, net);
    const { readSigningSecret } = await load('service.mjs');
    if (process.argv.includes('--service')) {
        const { createFanjiaoService } = await load('service.mjs');
        const { readMediaProxy, createMediaTransport } = await load('mediaTransport.mjs');
        const locations = { appPath: root, userData: output, isDev: true };
        const transport = await createMediaTransport(readMediaProxy(locations), session, net);
        const service = createFanjiaoService({ secret: readSigningSecret(locations), mediaTransport: transport });
        try {
            const started = performance.now();
            const source = await service.request('audioSource', { id: '117805', quality: 'high' });
            console.log(JSON.stringify({ stage: 'service-source', ms: Math.round(performance.now() - started) }));
            const response = await service.handleProtocol(new Request(source.url.replace('index.m3u8', 'segment/0.ts')));
            const bytes = (await response.arrayBuffer()).byteLength;
            console.log(JSON.stringify({ stage: 'service-segment', status: response.status, bytes, ms: Math.round(performance.now() - started) }));
            const subtitles = await service.request('lyrics', { id: '117805' });
            console.log(JSON.stringify({ stage: 'service-subtitle', lines: subtitles.lyrics?.lines.length }));
        } finally { service.dispose(); }
        return;
    }
    const { createFanjiaoClient } = await load('client.mjs');
    const { resolveVod } = await load('vod.mjs');
    const { readMediaAsset, parseManifest } = await load('session.mjs');
    const client = createFanjiaoClient(readSigningSecret({ appPath: root, userData: output, isDev: true }));
    const payload = await client.get('/walkman/api/audio/info', { audio_id: '117805' });
    const definition = process.argv.includes('--high') ? 'HQ' : 'FD';
    const media = await resolveVod(payload, definition);
    if (process.argv.includes('--metadata-only')) {
        console.log(JSON.stringify({ episode: '117805', ...media.metadata }));
        return;
    }
    const manifest = parseManifest(await readMediaAsset(media.url), media.url);
    const appHeaders = process.argv.includes('--app-ua') ? {
        'user-agent': 'aliplayer(appv=3.15.1&av=7.10.0&av2=7.10.0_51689961&os=android&ov=14&dm=RMX5200)',
    } : undefined;
    const reports = [];
    await mkdir(output, { recursive: true });
    for (const index of [0, 1, 2]) {
        for (const transport of proxyTransport ? ['chromium-proxy'] : index === 1 ? ['chromium', 'node'] : ['node', 'chromium']) {
            const started = performance.now();
            const record = { episode: '117805', definition: media.metadata.definition, index, transport,
                appUa: !!appHeaders, host: new URL(manifest.segments[index]).hostname, bytes: 0 };
            try {
                const fetcher = proxyTransport?.fetch || (transport === 'chromium' ? net.fetch.bind(net) : globalThis.fetch);
                const response = await fetcher(manifest.segments[index], { headers: appHeaders, redirect: 'error', signal: AbortSignal.timeout(20000) });
                record.headersMs = Math.round(performance.now() - started);
                record.status = response.status;
                for await (const chunk of response.body) record.bytes += chunk.length;
                record.ok = response.ok;
            } catch (error) { record.error = error.name; record.ok = false; }
            record.totalMs = Math.round(performance.now() - started);
            reports.push(record);
            console.log(JSON.stringify(record));
            await writeFile(path.join(output, `comparison-${definition}${proxyTransport ? '-chromium-proxy' : ''}${appHeaders ? '-app-ua' : ''}.json`), JSON.stringify(reports, null, 2));
        }
    }
}).catch(error => { console.error('Media transport probe failed:', error.name, String(error.message).replace(/https?:\/\/\S+/g, '[url]'),
    String(error.cause?.message || '').replace(/https?:\/\/\S+/g, '[url]')); process.exitCode = 1; }).finally(() => {
        proxyTransport?.dispose();
        if (process.exitCode) app.exit(process.exitCode);
        else app.quit();
    });
