import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// 实际专辑入口回归：正片队列、独立进度、重新加载恢复、自然结束和重播。
async function installStateReaders(page) {
    await page.waitForSelector('audio', { state: 'attached' });
    await page.evaluate(async () => {
        const url = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(name)).name;
        window.__getPlaybackState = (await import(url('/src/stores/usePlaybackStore.ts'))).usePlaybackStore.getState;
        window.__getEpisodes = (await import(url('/src/stores/useEpisodePlaybackStore.ts'))).useEpisodePlaybackStore.getState;
        window.__getAssignedSource = (await import(url('/src/services/playbackMediaSource.ts'))).getAssignedAudioSource;
    });
}
async function waitEpisode(page, id, position = 1, paused = false) {
    await page.waitForFunction(({ id, position, paused }) => {
        const state = window.__getPlaybackState();
        return state.currentSong?.id === id && [...document.querySelectorAll('audio')].some(audio =>
            window.__getAssignedSource(audio) === state.audioSrc && audio.readyState >= 3 && audio.paused === paused
            && audio.currentTime >= position);
    }, { id, position, paused }, { timeout: 45000 });
}
const clickTransport = async (page, label) => {
    const point = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight - 56 }));
    await page.mouse.move(20, 120);
    await page.mouse.move(point.x, point.y);
    await page.locator(`button[aria-label="${label}"]`).evaluate(button => button.click());
};
async function seekAndPause(page, time) {
    await page.evaluate(time => { [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime = time; }, time);
    await page.waitForFunction(time => [...document.querySelectorAll('audio')].some(audio => !audio.paused && !audio.seeking && audio.currentTime >= time + .1), time);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
}

export async function verifyEpisodeProgress(page, output) {
    await installStateReaders(page);
    await page.waitForTimeout(700);
    const panel = page.getByTestId('side-panel-list');
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    await panel.evaluate(panel => {
        const scroller = [...panel.querySelectorAll('div')].find(node => node.scrollHeight > node.clientHeight + 100
            && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
        scroller.scrollTop = 8 * 76;
    });
    await panel.getByText('第一集 那年、花火', { exact: true }).click();
    await waitEpisode(page, '120412');
    const mainQueue = await page.evaluate(() => window.__getPlaybackState().playQueue.map(song => song.id));
    assert.equal(mainQueue.length, 18);
    await seekAndPause(page, 90);
    await clickTransport(page, '下一首');
    await waitEpisode(page, '120443');
    await seekAndPause(page, 44);
    const saved = await page.evaluate(() => window.__getEpisodes().progress);
    assert.ok(saved['online:fanjiao:120412'].position >= 90 && saved['online:fanjiao:120412'].position < 95);
    assert.ok(saved['online:fanjiao:120443'].position >= 44 && saved['online:fanjiao:120443'].position < 49);
    await clickTransport(page, '上一首');
    await waitEpisode(page, '120412', 90);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
    const beforeReload = await page.evaluate(() => window.__getEpisodes().progress['online:fanjiao:120412'].position);
    await page.reload();
    await installStateReaders(page);
    await waitEpisode(page, '120412', beforeReload - .2, true);
    const restored = await page.evaluate(() => [...document.querySelectorAll('audio')].find(audio => audio.readyState >= 3).currentTime);
    assert.ok(Math.abs(restored - beforeReload) < 1);
    await page.locator('button[aria-label="返回播放器"]').evaluate(button => button.click());
    await page.keyboard.press('Space');
    await waitEpisode(page, '120412', beforeReload);
    await page.evaluate(() => { const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused); audio.currentTime = audio.duration - 1.2; });
    await waitEpisode(page, '120443', 44);
    assert.equal(await page.evaluate(() => window.__getEpisodes().progress['online:fanjiao:120412'].completed), true);
    await clickTransport(page, '上一首');
    await waitEpisode(page, '120412', 1);
    const replayedAt = await page.evaluate(() => [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime);
    assert.ok(replayedAt < 5, 'Completed episode must replay from the beginning');
    await clickTransport(page, '返回主页');
    // 重新加载应用不会恢复专辑导航；从正常搜索入口再次打开专辑。
    await page.getByPlaceholder('搜索广播剧…').first().fill('冬日花火');
    await page.getByPlaceholder('搜索广播剧…').first().press('Enter');
    await page.getByRole('button', { name: /冬日花火/ }).first().click();
    await page.getByRole('button', { name: '查看曲目', exact: true }).click();
    await page.waitForTimeout(700);
    await page.getByTestId('side-panel-list').evaluate(panel => {
        const scroller = [...panel.querySelectorAll('div')].find(node => node.scrollHeight > node.clientHeight + 100
            && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
        scroller.scrollTop = 8 * 76;
    });
    await page.screenshot({ path: path.join(output, 'episode-progress.png') });
    const text = await page.getByTestId('side-panel-list').innerText();
    assert.ok(text.includes('已播放'));
    await page.getByTestId('main-episode-toggle').evaluate(button => { if (button.getAttribute('aria-pressed') === 'true') button.click(); });
    await page.getByTestId('side-panel-list').getByText('1.5小剧场 留宿', { exact: true }).click();
    await waitEpisode(page, '120443', 44);
    const allQueue = await page.evaluate(() => window.__getPlaybackState().playQueue.map(song => song.id));
    assert.equal(allQueue.length, 18);
    await clickTransport(page, '返回主页');
    await page.getByRole('button', { name: '查看曲目', exact: true }).click();
    await page.waitForTimeout(700);
    await page.getByTestId('side-panel-list').evaluate(panel => {
        const scroller = [...panel.querySelectorAll('div')].find(node => node.scrollHeight > node.clientHeight + 100
            && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
        scroller.scrollTop = 8 * 76;
    });
    await page.getByTestId('side-panel-list').locator('[data-episode-id="120443"]').getByRole('button', { name: '从头播放' }).click();
    // 同一分集的旧音轨在异步取源期间仍可能播放，等新音轨真的从头前进再断言。
    await page.waitForFunction(() => window.__getPlaybackState().currentSong?.id === '120443'
        && [...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.readyState >= 3
            && audio.currentTime > 1 && audio.currentTime < 5), null, { timeout: 30000 });
    const restartedAt = await page.evaluate(() => [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime);
    assert.ok(restartedAt < 5, 'Restart action must ignore the old episode position');
    const result = { mainQueue, firstPosition: saved['online:fanjiao:120412'].position,
        miniPosition: saved['online:fanjiao:120443'].position, restored, completedReplayPosition: replayedAt,
        naturalAdvance: true, allQueueCount: allQueue.length, progressVisible: true, restartedAt };
    await writeFile(path.join(output, 'episode-progress.json'), JSON.stringify(result, null, 2));
    console.log('Episode progress verification passed:', JSON.stringify(result));
}
