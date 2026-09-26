import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// 在独立 headless Chrome 中验证真实音频解码、传输控制和字幕时间轴，不连接用户浏览器档案。
const origin = process.env.FANJIAO_PROBE_ORIGIN || 'http://127.0.0.1:3411';
const executablePath = process.env.FANJIAO_PROBE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const output = 'test-results/fanjiao-playback';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 950 } });
const report = { at: new Date().toISOString(), checks: {}, errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.probeEpisode || window.probeDiagnostics?.fatalErrors.length,
        null, { timeout: 60000 });
    const metadata = await page.evaluate(() => ({ title: window.probeEpisode?.title,
        duration: window.probeEpisode?.duration, cues: window.probeEpisode?.lyrics?.lines.length,
        errors: window.probeDiagnostics.fatalErrors }));
    assert.equal(metadata.errors.length, 0);
    assert.equal(metadata.cues, 14);
    assert.ok(metadata.duration > 46 && metadata.duration < 48);
    report.metadata = metadata;
    const initialStats = await page.evaluate(() => fetch('/api/stats').then(response => response.json()));
    await page.evaluate(async () => {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        const source = context.createMediaElementSource(document.querySelector('audio'));
        source.connect(analyser);
        analyser.connect(context.destination);
        window.probeAnalyser = analyser;
        window.probeAudioContext = context;
        await context.resume();
    });
    const start = Date.now();
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 1.5,
        null, { timeout: 20000 });
    report.checks.playbackStartedMs = Date.now() - start;
    report.checks.peakRms = await page.evaluate(async () => {
        const samples = new Float32Array(window.probeAnalyser.fftSize);
        let peak = 0;
        for (let index = 0; index < 10; index += 1) {
            window.probeAnalyser.getFloatTimeDomainData(samples);
            peak = Math.max(peak, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length));
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return peak;
    });
    assert.ok(report.checks.peakRms > 0.0001, 'Decoded audio must contain signal');
    await page.locator('#pause').click();
    const pausedAt = await page.locator('audio').evaluate(audio => audio.currentTime);
    await page.waitForTimeout(700);
    report.checks.pauseDriftSeconds = await page.locator('audio').evaluate(audio => audio.currentTime) - pausedAt;
    assert.ok(Math.abs(report.checks.pauseDriftSeconds) < .05);
    await page.locator('#seek').click();
    await page.waitForFunction(() => {
        const audio = document.querySelector('audio');
        return !audio.seeking && Math.abs(audio.currentTime - 30) < .5;
    }, null, { timeout: 15000 });
    const cues = await page.evaluate(() => {
        const time = document.querySelector('audio').currentTime;
        return { actual: [...document.querySelectorAll('#subtitles li.active')].map(row => row.dataset.cueId),
            expected: window.probeEpisode.lyrics.lines.filter(line => time >= line.startTime && time < line.endTime).map(line => line.id),
            time };
    });
    assert.ok(cues.expected.length > 0);
    assert.deepEqual(cues.actual, cues.expected);
    report.checks.seekAndSubtitle = cues;
    await page.screenshot({ path: `${output}/preview.png`, fullPage: true });
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 31.5);
    const before = await page.evaluate(() => document.querySelector('audio').currentTime);
    await page.locator('#refresh').click();
    await page.waitForFunction(() => window.probeDiagnostics.refreshCount === 1, null, { timeout: 60000 });
    await page.waitForFunction(time => !document.querySelector('audio').paused
        && document.querySelector('audio').currentTime > time + 1, before, { timeout: 20000 });
    let stats = await page.evaluate(() => fetch('/api/stats').then(response => response.json()));
    assert.equal(stats.lastRefreshReason, 'local-expiry');
    assert.equal(stats.refreshes - initialStats.refreshes, 1);
    report.checks.expiryRefresh = { generationChange: stats.generations - initialStats.generations,
        refreshes: stats.refreshes - initialStats.refreshes, resumed: true };
    await page.locator('audio').evaluate(audio => { audio.currentTime = 0; return audio.play(); });
    await page.waitForFunction(() => document.querySelector('audio').ended, null, { timeout: 65000 });
    report.checks.completePlayback = await page.locator('audio').evaluate(audio => ({
        ended: audio.ended, currentTime: audio.currentTime, duration: audio.duration,
    }));
    stats = await page.evaluate(() => fetch('/api/stats').then(response => response.json()));
    assert.equal(stats.cachedSegments, await page.evaluate(() => window.probeEpisode.segmentCount));
    report.stats = stats;
    await page.locator('#pause').click();
    report.diagnostics = await page.evaluate(() => window.probeDiagnostics);
    assert.deepEqual(report.diagnostics.fatalErrors, []);
    assert.deepEqual(report.errors, []);
    report.success = true;
    console.log(JSON.stringify({ success: true, metadata: report.metadata, checks: report.checks, stats }));
} catch (error) {
    report.success = false;
    report.failure = { name: error.name, message: error.message };
    report.state = await page.evaluate(() => ({ status: document.querySelector('#status')?.textContent,
        audio: document.querySelector('audio') ? { currentTime: document.querySelector('audio').currentTime,
            readyState: document.querySelector('audio').readyState, error: document.querySelector('audio').error?.code } : null,
        diagnostics: window.probeDiagnostics })).catch(() => null);
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    console.error(JSON.stringify({ failure: report.failure, state: report.state }));
    process.exitCode = 1;
} finally {
    await writeFile(`${output}/browser-verification.json`, JSON.stringify(report, null, 2));
    await browser.close();
}
