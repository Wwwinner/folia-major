import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// 真实底栏按钮回归：队列不变，导航与预览即时切换，手动选中的附加内容仍可播放。
export async function verifyEpisodeNavigation(page, output) {
    const panel = page.getByTestId('side-panel-list');
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    await page.waitForTimeout(700);
    await panel.evaluate(panel => {
        const scroller = [...panel.querySelectorAll('div')].find(node => node.scrollHeight > node.clientHeight + 100
            && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
        scroller.scrollTop = 8 * 76;
    });
    await panel.getByText('第一集 那年、花火', { exact: true }).click();
    const waitEpisode = id => page.waitForFunction(id => {
        const state = window.__getPlaybackState();
        return state.currentSong?.id === id && [...document.querySelectorAll('audio')].some(audio =>
            window.__getAssignedSource(audio) === state.audioSrc && !audio.paused && audio.readyState >= 3 && audio.currentTime > 1);
    }, id, { timeout: 45000 });
    const reveal = async () => {
        const point = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight - 56 }));
        await page.mouse.move(20, 100);
        await page.mouse.move(point.x, point.y);
    };
    const clickTransport = async label => { await reveal(); await page.locator(`button[aria-label="${label}"]`).evaluate(button => button.click()); };
    const queue = () => page.evaluate(() => window.__getPlaybackState().playQueue.map(song => song.id));
    await waitEpisode('120412');
    const fullQueue = await queue();
    assert.equal(fullQueue.length, 18);
    await reveal();
    const toggle = page.getByTestId('main-episode-toggle');
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal((await toggle.textContent()).trim(), '');
    assert.equal(await page.locator('button[aria-label="下一首"]').getAttribute('title'), '1.5小剧场 留宿');
    for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await reveal();
        await toggle.waitFor({ state: 'visible' });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(output, `episode-button-${width}.png`) });
        const bounds = await toggle.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    }
    await page.setViewportSize({ width: 1100, height: 800 });
    await reveal();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await queue(), fullQueue);
    assert.equal(await page.locator('button[aria-label="下一首"]').getAttribute('title'), '花絮01 Part ①');
    await clickTransport('下一首');
    await waitEpisode('120441');
    await reveal();
    await toggle.click();
    assert.deepEqual(await queue(), fullQueue);
    await clickTransport('下一首');
    await waitEpisode('120443');
    await clickTransport('上一首');
    await waitEpisode('120412');
    await page.evaluate(() => { const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused); audio.currentTime = audio.duration - 1.2; });
    await waitEpisode('120443');
    assert.deepEqual(await queue(), fullQueue);
    const result = { queueCount: fullQueue.length, iconOnly: true, immediateToggle: true,
        offNext: '120441', onNext: '120443', onPrevious: '120412', automaticNext: '120443', queueUnchanged: true };
    await writeFile(path.join(output, 'episode-navigation.json'), JSON.stringify(result, null, 2));
    console.log('Episode navigation verified:', JSON.stringify(result));
}
