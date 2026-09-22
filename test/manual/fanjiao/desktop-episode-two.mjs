import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// 第二集回归：经实际分集列表点播，并确认有声输出和远距离跳转后仍是同一集。
export async function verifyEpisodeTwo(page, output, errors, { seekTimeout = 30000 } = {}) {
    // 列表打开时会自动定位当前曲目；等入场与定位结束再滚向末尾。
    await page.waitForTimeout(700);
    await page.getByTestId('side-panel-list').evaluate(panel => {
        const scroller = [...panel.querySelectorAll('div')].find(node => node.scrollHeight > node.clientHeight + 100
            && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
        if (!scroller) throw new Error('Episode list scroll container not found');
        scroller.scrollTop = scroller.scrollHeight;
    });
    await page.getByTestId('side-panel-list').getByText('第二集 相约，东城塔', { exact: true }).click();
    await page.waitForFunction(() => {
        const state = window.__getPlaybackState();
        return state.currentSong?.id === '120484' && state.audioSrc?.startsWith('folia-hls://')
            && [...document.querySelectorAll('audio')].some(audio => window.__getAssignedSource(audio) === state.audioSrc
                && !audio.paused && audio.readyState >= 3 && audio.currentTime > 2);
    }, null, { timeout: 45000 });
    await page.waitForFunction(() => window.__fanjiaoAnalysers.some(analyser => {
        const bytes = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(bytes);
        return Math.sqrt(bytes.reduce((sum, value) => sum + value * value, 0) / bytes.length) > .0001;
    }), null, { timeout: 15000 });
    const initial = await page.evaluate(() => {
        const state = window.__getPlaybackState();
        const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused);
        return { id: state.currentSong.id, duration: audio.duration, position: audio.currentTime,
            cues: state.lyrics?.lines.length || 0, mse: audio.currentSrc.startsWith('blob:') };
    });
    assert.ok(initial.duration > 2200 && initial.duration < 2350);
    assert.ok(initial.cues > 0);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
    await page.keyboard.press('Space');
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio => !audio.paused));
    await page.evaluate(() => { [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime = 1200; });
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio => !audio.paused
        && !audio.seeking && audio.readyState >= 3 && audio.currentTime > 1201), null, { timeout: seekTimeout });
    assert.equal(await page.evaluate(() => window.__getPlaybackState().currentSong.id), '120484');
    await page.screenshot({ path: path.join(output, 'episode-two.png') });
    const result = { initial, audible: true, pauseResume: true, seekSeconds: 1200, errors };
    await writeFile(path.join(output, 'episode-two.json'), JSON.stringify(result, null, 2));
    console.log('Episode two desktop verification passed:', JSON.stringify(result));
}
