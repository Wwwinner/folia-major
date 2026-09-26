import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyEpisodeTwo } from './desktop-episode-two.mjs';
import { verifyEpisodeProgress } from './desktop-episode-progress.mjs';
import { verifyEpisodeNavigation } from './desktop-episode-navigation.mjs';
import { verifyHome, verifyPopular } from './desktop-home.mjs';
import { verifyHomeRail } from './desktop-home-rail.mjs';
import { verifyAllSections } from './desktop-all-sections.mjs';
import { verifyRankings } from './desktop-rankings.mjs';
import { verifyBanner } from './desktop-banner.mjs';
import { verifyHistory } from './desktop-history.mjs';
import { verifyDialogue } from './desktop-dialogue.mjs';
import { verifyStreamRecovery } from './desktop-stream-recovery.mjs';
import { verifyEpisodeSix } from './desktop-episode-six.mjs';
import { traceDesktopMedia } from './desktop-media-trace.mjs';

// 在独立用户目录启动真实 Folia Electron；只保存无凭据的界面与验证摘要。
const root = process.cwd();
const episodeTwo = process.argv.includes('--episode-two');
const episodeProgress = process.argv.includes('--episode-progress');
const episodeNavigation = process.argv.includes('--episode-navigation');
const homepage = process.argv.includes('--home');
const popular = process.argv.includes('--popular');
const homeRail = process.argv.includes('--home-rail');
const allSections = process.argv.includes('--all-sections');
const rankings = process.argv.includes('--rankings');
const banner = process.argv.includes('--banner');
const history = process.argv.includes('--history');
const dialogue = process.argv.includes('--dialogue');
const streamRecovery = process.argv.includes('--stream-recovery');
const episodeSix = process.argv.includes('--episode-six');
const output = path.join(root, streamRecovery ? 'test-results/fanjiao-desktop-stream-recovery' : dialogue ? 'test-results/fanjiao-desktop-dialogue' : history ? 'test-results/fanjiao-desktop-history' : banner ? 'test-results/fanjiao-desktop-banner' : rankings ? 'test-results/fanjiao-desktop-rankings' : allSections ? 'test-results/fanjiao-desktop-all-sections' : homeRail ? 'test-results/fanjiao-desktop-home-rail' : popular ? 'test-results/fanjiao-desktop-popular' : homepage ? 'test-results/fanjiao-desktop-home' : episodeNavigation ? 'test-results/fanjiao-desktop-navigation' : episodeProgress ? 'test-results/fanjiao-desktop-progress' : episodeTwo ? 'test-results/fanjiao-desktop-ep2' : 'test-results/fanjiao-desktop');
await mkdir(output, { recursive: true });
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${path.join(output, `profile-${process.pid}`)}`, '--autoplay-policy=no-user-gesture-required'],
    env: { ...process.env, ELECTRON_DEV: 'true' }, cwd: root, timeout: 60000 });
try {
    if (episodeSix) app.process().on('exit', (code, signal) => console.log('Isolated test exit:', code, signal));
    if (episodeSix) app.process().stdout.on('data', bytes => {
        for (const line of bytes.toString().split(/\r?\n/)) if (line.startsWith('[Media debug]')) console.log(line);
    });
    if (episodeSix) app.process().stderr?.on('data', bytes => {
        for (const line of bytes.toString().split(/\r?\n/)) if (/Fanjiao stream|FATAL|crash|exited unexpectedly|Error|Exception|ERR_|^\s+at /.test(line)) {
            console.log(line.replace(/(?:https?|folia-hls):\/\/\S+/g, '[url]').slice(0, 500));
        }
    });
    await app.firstWindow({ timeout: 60000 });
    let page;
    for (let attempt = 0; attempt < 120; attempt++) {
        page = app.windows().find(window => window.url().startsWith('http://localhost:3000/'));
        if (page) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!page) throw new Error('Folia main window did not open');
    await page.bringToFront();
    console.log('Electron window created.');
    if (episodeSix) await app.evaluate(({ app }) => {
        process.on('uncaughtExceptionMonitor', error => {
            console.log('[Media debug] uncaught', String(error.stack).replace(/(?:https?|folia-hls):\/\/\S+/g, '[url]'));
            app.exit(1);
        });
    });
    if (episodeSix && !process.argv.includes('--no-trace')) await traceDesktopMedia(app, output);
    const errors = [];
    const diagnostic = [];
    const resourceFailures = [];
    page.on('console', message => {
        if (message.type() === 'warning' || message.type() === 'error' || /\[(?:Audio|Playback|HLS|Prefetch)\]/.test(message.text())) diagnostic.push(message.text().slice(0, 600));
        if (episodeSix && /\[OnlinePlayback\]|\[HLS\]/.test(message.text())) console.log(message.text().replace(/(?:https?|folia-hls):\/\/\S+/g, '[url]').slice(0, 500));
    });
    page.on('response', response => {
        if (response.url().startsWith('folia-hls://')) diagnostic.push(`HLS response ${response.status()} ${new URL(response.url()).pathname.split('/')[1]} ${new URL(response.url()).pathname.split('/').at(-1)}`);
        if (response.status() >= 400) {
            const url = new URL(response.url());
            resourceFailures.push({ status: response.status(), type: response.request().resourceType(), host: url.host,
                path: url.protocol === 'folia-hls:' ? `/${url.pathname.split('/')[1]}/${url.pathname.split('/').at(-1)}` : url.pathname });
        }
    });
    page.on('pageerror', error => errors.push(error.message.slice(0, 200)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)); });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('audio', { state: 'attached', timeout: 20000 }).catch(() => {});
    await page.evaluate(async standard => {
        const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(name)).name;
        window.__getPlaybackState = (await import(moduleUrl('/src/stores/usePlaybackStore.ts'))).usePlaybackStore.getState;
        window.__getCollectionState = (await import(moduleUrl('/src/stores/useCollectionNavigationStore.ts'))).useCollectionNavigationStore.getState;
        window.__getAssignedSource = (await import(moduleUrl('/src/services/playbackMediaSource.ts'))).getAssignedAudioSource;
        if (standard) (await import(moduleUrl('/src/stores/useAudioSettingsStore.ts'))).useAudioSettingsStore.getState().setAudioQuality('standard');
    }, episodeSix && process.argv.includes('--standard'));
    await page.screenshot({ path: path.join(output, 'initial.png') });
    await writeFile(path.join(output, 'initial.json'), JSON.stringify({ title: await page.title(), errors,
        text: (await page.locator('body').innerText()).slice(0, 5000) }, null, 2));
    page.setDefaultTimeout(15000);
    try {
        const welcome = page.getByRole('button', { name: '我知道了', exact: true });
        await welcome.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        if (await welcome.isVisible()) await welcome.click();
        const entryChoice = page.getByRole('button', { name: '就这样', exact: true });
        await entryChoice.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
        if (await entryChoice.isVisible()) await entryChoice.click();
        const active = await page.evaluate(async () => (await import('/src/stores/useOnlineProviderAccountStore.ts')).useOnlineProviderAccountStore.getState().activeProviderId);
        if (active !== 'fanjiao') {
            await page.getByRole('button', { name: '切换至饭角' }).click();
            await page.getByRole('button', { name: '确定', exact: true }).click();
        }
        if (history) {
            await verifyHistory(page, output, errors, resourceFailures);
        } else if (banner) {
            await verifyBanner(page, output, errors, resourceFailures);
        } else if (rankings) {
            await verifyRankings(page, output, errors, resourceFailures);
        } else if (allSections) {
            await verifyAllSections(page, output, errors, resourceFailures);
        } else if (homeRail) {
            await verifyHomeRail(page, output, errors, resourceFailures);
        } else if (popular) {
            await verifyPopular(page, output, errors, resourceFailures);
        } else if (homepage) {
            await verifyHome(page, output, errors, resourceFailures);
        } else {
        await page.getByPlaceholder('搜索广播剧…').first().fill(episodeSix ? '总裁，夫人和白月光跑了' : '冬日花火');
        await page.getByPlaceholder('搜索广播剧…').first().press('Enter');
        const album = page.locator('section.fixed.inset-0').getByRole('button', { name: episodeSix ? /总裁，夫人和白月光跑了/ : /冬日花火/ }).first();
        await album.waitFor();
        await page.screenshot({ path: path.join(output, 'search.png') });
        await album.click();
        await page.waitForFunction(expectedId => {
            const state = window.__getCollectionState();
            return state.snapshot?.stack.at(-1)?.id === expectedId;
        }, episodeSix ? '111421' : '111726');
        await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, 'album.png') });
        await writeFile(path.join(output, 'album.json'), JSON.stringify({ errors,
            text: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2));
        await page.evaluate(() => {
            window.__fanjiaoAnalysers = [];
            window.__fanjiaoEvents = [];
            for (const audio of document.querySelectorAll('audio')) {
                for (const name of ['loadstart', 'loadedmetadata', 'play', 'playing', 'pause', 'error', 'ended', 'emptied']) {
                    audio.addEventListener(name, () => window.__fanjiaoEvents.push({ name, time: audio.currentTime,
                        at: performance.now(), duration: audio.duration, error: audio.error?.code, paused: audio.paused }));
                }
            }
            const create = AudioContext.prototype.createAnalyser;
            AudioContext.prototype.createAnalyser = function () {
                const analyser = create.call(this);
                window.__fanjiaoAnalysers.push(analyser);
                return analyser;
            };
        });
        await page.getByRole('button', { name: '查看曲目', exact: true }).click();
        if (episodeSix) {
            await verifyEpisodeSix(page, output, app);
        } else if (streamRecovery) {
            await verifyStreamRecovery(page, app, output, errors);
        } else if (dialogue) {
            await verifyDialogue(page, output, errors, resourceFailures);
        } else if (episodeNavigation) {
            await verifyEpisodeNavigation(page, output);
        } else if (episodeProgress) {
            await verifyEpisodeProgress(page, output);
        } else if (episodeTwo) {
            await verifyEpisodeTwo(page, output, errors);
        } else {
        await page.getByTestId('side-panel-list').getByText('沈楝 早安铃声 5K追剧福利', { exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime > 2), null, { timeout: 30000 });
        // 福利音基础回归使用全部分集跳转，队列本身始终完整。
        await page.getByTestId('main-episode-toggle').evaluate(button => { if (button.getAttribute('aria-pressed') === 'true') button.click(); });
        const playback = await page.evaluate(async () => {
            const moduleUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/stores/usePlaybackStore.ts')).name;
            const state = (await import(moduleUrl)).usePlaybackStore.getState();
            const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused);
            return { id: state.currentSong?.id, queue: state.playQueue.map(song => song.id), cueCount: state.lyrics?.lines.length,
                duration: audio.duration, position: audio.currentTime, mse: audio.currentSrc.startsWith('blob:'),
                sourceScheme: state.audioSrc ? new URL(state.audioSrc).protocol : null };
        });
        await page.screenshot({ path: path.join(output, 'playing.png') });
        assert.equal(playback.id, '120361');
        assert.equal(playback.sourceScheme, 'folia-hls:');
        assert.equal(playback.cueCount, 14);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
        const pausedAt = await page.evaluate(() => [...document.querySelectorAll('audio')].find(audio => audio.duration > 0).currentTime);
        await new Promise(resolve => setTimeout(resolve, 500));
        const pauseDrift = await page.evaluate(time => [...document.querySelectorAll('audio')].find(audio => audio.duration > 0).currentTime - time, pausedAt);
        assert.ok(pauseDrift < .1);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio => !audio.paused));
        await page.evaluate(() => { [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime = 30; });
        await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio => !audio.paused && !audio.seeking && audio.currentTime >= 30));
        const seek = await page.evaluate(async () => {
            const moduleUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/stores/usePlaybackStore.ts')).name;
            const state = (await import(moduleUrl)).usePlaybackStore.getState();
            const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused);
            const rms = Math.max(0, ...window.__fanjiaoAnalysers.map(analyser => {
                const bytes = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(bytes);
                return Math.sqrt(bytes.reduce((sum, value) => sum + value * value, 0) / bytes.length);
            }));
            return { position: audio.currentTime, rms, source: state.audioSrc,
                cueIds: state.lyrics.lines.filter(line => line.startTime <= 30 && line.endTime > 30).map(line => line.id) };
        });
        await page.evaluate(() => { [...document.querySelectorAll('audio')].find(audio => !audio.paused).dispatchEvent(new Event('error')); });
        await page.waitForFunction(previous => {
            const state = window.__getPlaybackState();
            return state.audioSrc !== previous && state.currentSong?.id === '120361'
                && [...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime >= 30);
        }, seek.source, { timeout: 30000 });
        delete seek.source;
        assert.ok(seek.rms > .0001, 'Audio graph must contain decoded sound');
        await page.screenshot({ path: path.join(output, 'seek.png') });
        const waitForEpisode = async id => page.waitForFunction(id => {
            const state = window.__getPlaybackState();
            const getAssignedAudioSource = window.__getAssignedSource;
            const audio = [...document.querySelectorAll('audio')].find(audio => getAssignedAudioSource(audio) === state.audioSrc
                && audio.currentSrc === audio.getAttribute('src') && audio.readyState >= 3 && !audio.paused && audio.currentTime > 1);
            if (state.currentSong?.id !== id || !state.audioSrc || !audio) { window.__stableEpisode = null; return false; }
            const key = `${id}:${audio.currentSrc}`;
            if (window.__stableEpisode?.key !== key) { window.__stableEpisode = { key, at: performance.now() }; return false; }
            return performance.now() - window.__stableEpisode.at > 750;
        }, id, { timeout: 30000 });
        const controlsPoint = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight - 56 }));
        await page.mouse.move(controlsPoint.x, controlsPoint.y);
        await page.locator('button[aria-label="下一首"]').evaluate(button => button.click());
        await waitForEpisode('120362');
        await page.screenshot({ path: path.join(output, 'next-episode.png') });
        await page.locator('button[aria-label="上一首"]').evaluate(button => button.click());
        await waitForEpisode('120361');
        await page.evaluate(() => {
            const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused);
            audio.currentTime = audio.duration - 1.5;
        });
        await waitForEpisode('120362');
        // 用一秒静音 WAV 验证 HLS cleanup 不会移除 React 刚提交的普通文件源。
        const wave = Buffer.alloc(44 + 16000);
        wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
        wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
        wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
        wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(16000, 40);
        await page.evaluate(src => window.__getPlaybackState().setAudioSrc(src), `data:audio/wav;base64,${wave.toString('base64')}`);
        await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio => audio.getAttribute('src')?.startsWith('data:audio/wav')
            && audio.readyState >= 2 && Math.abs(audio.duration - 1) < .01));
        const result = { playback, pauseDrift, seek, recovery: true, next: true, previous: true, naturalAdvance: true, directSourceSwitch: true, errors };
        await writeFile(path.join(output, 'playback.json'), JSON.stringify(result, null, 2));
        console.log('Desktop playback verification passed:', JSON.stringify(result));
        }
        }
    } catch (error) {
        if (page.isClosed()) {
            console.error('Desktop verification closed early:', String(error.message).replace(/(?:https?|folia-hls):\/\/\S+/g, '[url]').slice(0, 400));
            throw error;
        }
        await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, errors,
            diagnostic, resourceFailures, events: await page.evaluate(() => window.__fanjiaoEvents),
            text: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2));
        await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 3000 }).catch(() => {});
        throw error;
    }
} finally { await app.close(); }
