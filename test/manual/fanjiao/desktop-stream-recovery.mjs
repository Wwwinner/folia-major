import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyEpisodeTwo } from './desktop-episode-two.mjs';

// 独立 Electron 配置中注入一次上游 503，并让真实 MSE 缓冲耗尽，验证无需用户拖动即可恢复。
export async function verifyStreamRecovery(page, app, output, errors) {
    const recoveryActions = [];
    app.process().stderr?.on('data', bytes => {
        for (const line of bytes.toString().split(/\r?\n/)) if (line.includes('[Fanjiao stream]')) console.log(line);
    });
    page.on('console', message => {
        if (message.text().startsWith('[HLS] Stall recovery')) recoveryActions.push(message.text());
    });
    await app.evaluate(() => {
        const original = globalThis.fetch;
        globalThis.__streamFaults = 0;
        globalThis.fetch = async (...args) => {
            const url = new URL(String(args[0]));
            if (globalThis.__streamFaults === 0 && url.pathname.endsWith('.ts')) {
                globalThis.__streamFaults++;
                return new Response(null, { status: 503 });
            }
            return original(...args);
        };
    });
    await page.evaluate(async () => {
        const resource = performance.getEntriesByType('resource').find(entry => /\/hls[^/]*\.js(?:\?|$)/.test(entry.name));
        if (!resource) throw new Error('Loaded HLS module not found');
        const module = await import(resource.name);
        const Hls = module.default;
        window.__streamTestFetchLoader = module.FetchLoader;
        const attach = Hls.prototype.attachMedia;
        Hls.prototype.attachMedia = function (media) {
            window.__streamTestHls = this;
            return attach.call(this, media);
        };
    });
    await verifyEpisodeTwo(page, output, errors, { seekTimeout: 90000 });
    assert.equal(await app.evaluate(() => globalThis.__streamFaults), 1, 'The injected upstream failure must be exercised');
    const fault = await page.evaluate(async () => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
        const hls = window.__streamTestHls;
        if (!audio || hls?.media !== audio || !audio.buffered.length) throw new Error('Active HLS track not found');
        const edge = audio.buffered.end(audio.buffered.length - 1);
        if (edge >= audio.duration - 5) throw new Error('Need a buffer edge before the end of the episode');
        await new Promise(resolve => {
            const settled = () => { clearTimeout(timeout); audio.removeEventListener('seeked', settled); resolve(); };
            const timeout = setTimeout(settled, 2000);
            audio.addEventListener('seeked', settled);
            audio.currentTime = edge - 0.3;
        });
        hls.stopLoad();
        // 让下一片的加载器进入无回调的等待：不会触发 fatal，只有正式恢复路径取消后才放行。
        const prototype = window.__streamTestFetchLoader.prototype;
        const load = prototype.load, abort = prototype.abort;
        let blockedLoader = null, armed = true;
        prototype.load = function (context, config, callbacks) {
            if (armed && context.url.startsWith('folia-hls:') && /\/segment\//.test(context.url)) {
                this.context = context;
                this.stats.loading.start = performance.now();
                blockedLoader = this;
                window.__streamBlocked = true;
                return;
            }
            return load.call(this, context, config, callbacks);
        };
        prototype.abort = function (...args) {
            if (this === blockedLoader) { armed = false; window.__streamRecovered = true; }
            return abort.apply(this, args);
        };
        hls.startLoad(audio.currentTime);
        window.__streamFaultSource = state.audioSrc;
        return { edge, position: audio.currentTime, episode: state.currentSong.id };
    });
    await page.waitForFunction(() => window.__streamBlocked, null, { timeout: 15000 });
    await page.waitForFunction(edge => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
        return window.__streamRecovered && audio && !audio.paused && audio.readyState >= 3 && audio.currentTime > edge + 1;
    }, fault.edge, { timeout: 120000 });
    const recovered = await page.evaluate(() => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
        return { episode: state.currentSong.id, position: audio.currentTime, readyState: audio.readyState,
            sameSource: state.audioSrc === window.__streamFaultSource, paused: audio.paused };
    });
    assert.equal(recovered.episode, fault.episode);
    assert.ok(recoveryActions.some(message => message.includes('reload')), 'Watchdog must restart the stalled loader');
    // 暂停不能被恢复计时器擅自播放。
    await page.evaluate(() => {
        const state = window.__getPlaybackState();
        [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc).pause();
    });
    const actionCount = recoveryActions.length;
    await page.waitForTimeout(11000);
    assert.equal(recoveryActions.length, actionCount);
    const result = { upstream503Recovered: true, fault, recovered, recoveryActions, pauseRespected: true };
    await writeFile(path.join(output, 'stream-recovery.json'), JSON.stringify(result, null, 2));
    console.log('Stream recovery verified:', JSON.stringify(result));
}
