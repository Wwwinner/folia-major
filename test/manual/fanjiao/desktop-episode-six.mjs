import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// 用户报告的第六期实播验证；记录脱敏的分片编号和当前缓冲，确认相邻集不抢首播。
export async function verifyEpisodeSix(page, output, app) {
    await page.evaluate(() => {
        window.__episodeSixRequests = [];
        const fetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (value.startsWith('folia-hls://') && new URL(value).pathname.endsWith('/segment/0.ts')) {
                const state = window.__getPlaybackState();
                const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
                let ahead = 0;
                if (audio) for (let i = 0; i < audio.buffered.length; i++) {
                    if (audio.buffered.start(i) <= audio.currentTime && audio.buffered.end(i) > audio.currentTime) ahead = audio.buffered.end(i) - audio.currentTime;
                }
                window.__episodeSixRequests.push({ episode: new URL(value).pathname.split('/')[1],
                    currentEpisode: state.currentSong?.id, readyState: audio?.readyState, paused: audio?.paused,
                    time: audio?.currentTime, ahead, at: performance.now() });
            }
            return fetch(input, init);
        };
    });
    await page.waitForTimeout(700);
    const target = page.getByTestId('side-panel-list').getByText('第六期', { exact: true });
    for (let step = 0; step < 20 && !await target.count(); step++) {
        await page.getByTestId('side-panel-list').evaluate(panel => {
            const scroller = [...panel.querySelectorAll('div')].find(node => node.scrollHeight > node.clientHeight + 100
                && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
            if (!scroller) throw new Error('Episode list scroll container not found');
            scroller.scrollTop += scroller.clientHeight * 0.8;
        });
        await page.waitForTimeout(80);
    }
    const started = Date.now();
    await target.click();
    console.log('Episode six selected.');
    const proxyRoute = process.argv.includes('--direct-check') ? await app.evaluate(async ({ session }) => {
        const route = await session.fromPartition('folia-fanjiao-media').resolveProxy('https://play-offline.fanjiao.co');
        return route.split(/\s|;/)[0];
    }) : undefined;
    if (proxyRoute !== undefined) {
        console.log('Media route:', proxyRoute);
        assert.equal(proxyRoute, 'DIRECT');
    }
    // 播放验证期间隐藏独立测试窗口，轮询不用 rAF，避免占据用户桌面或被误关闭。
    if (!process.argv.includes('--visible')) {
        await app.evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) {
                window.webContents.setBackgroundThrottling(false); window.hide();
            }
        });
        console.log('Isolated playback window hidden.');
    }
    await page.waitForFunction(() => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
        return state.currentSong?.id === '117805' && audio && !audio.paused && audio.readyState >= 3 && audio.currentTime > 2;
    }, null, { timeout: 90000, polling: 500 });
    const startupMs = Date.now() - started;
    console.log('Episode six playback started:', startupMs);
    await page.waitForFunction(() => window.__fanjiaoAnalysers.some(analyser => {
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) > 0.0001;
    }), null, { timeout: 15000, polling: 500 });
    // 网络不足以填满缓冲时，预取应继续等待；实播仍须推进至少 90 秒。
    await page.waitForFunction(() => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
        return state.currentSong?.id === '117805' && audio && !audio.paused && audio.currentTime >= 90;
    }, null, { timeout: 240000, polling: 500 });
    const result = await page.evaluate(() => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(node => window.__getAssignedSource(node) === state.audioSrc);
        return { id: state.currentSong?.id, title: state.currentSong?.name, position: audio?.currentTime,
            readyState: audio?.readyState, paused: audio?.paused, qualityPreference: localStorage.getItem('default_audio_quality') || 'high',
            buffered: audio ? Array.from({ length: audio.buffered.length }, (_, i) => [audio.buffered.start(i), audio.buffered.end(i)]) : [],
            events: window.__fanjiaoEvents, requests: window.__episodeSixRequests };
    });
    assert.equal(result.id, '117805');
    assert.equal(result.paused, false);
    for (const request of result.requests.filter(item => item.episode !== '117805')) {
        assert.ok(request.readyState >= 3 && !request.paused && request.ahead >= 29.5, 'Background prefetch must yield to current playback');
    }
    await writeFile(path.join(output, 'episode-six.json'), JSON.stringify({ startupMs, audible: true, proxyRoute, ...result }, null, 2));
    console.log('Episode six verified:', JSON.stringify({ startupMs, audible: true, proxyRoute, ...result }));
}
