import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyResources } from './desktop-home.mjs';

// 用真实饭角 HLS 与正式模式选择器验证句级字幕和点击定位，不直接改播放器时间状态。
async function togglePlayback(page) {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Space');
}
export async function verifyDialogue(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.getByTestId('side-panel-list').getByText('沈楝 早安铃声 5K追剧福利', { exact: true }).click();
    await page.waitForFunction(() => window.__getPlaybackState().lyrics?.lines.length > 0
        && [...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime > 2), null, { timeout: 45000 });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette-panel');
    await palette.waitFor();
    await palette.getByRole('combobox').fill('选择可视化');
    await palette.getByText('选择可视化', { exact: true }).first().waitFor();
    await page.keyboard.press('Enter');
    await palette.locator('[data-picker-mode="dialogue"]').waitFor();
    await palette.getByRole('combobox').fill('对白');
    await palette.locator('[data-picker-mode="dialogue"]').click();
    const mode = page.getByTestId('visualizer-dialogue');
    await mode.waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('visualizer_mode')), 'dialogue');
    await page.evaluate(() => {
        const audio = [...document.querySelectorAll('audio')].find(audio => audio.readyState >= 3 && audio.duration > 30);
        audio.currentTime = 29.9;
    });
    await togglePlayback(page);
    // 等目标分片真正解码并前进，再开始回听操作；字幕时钟到位并不等于媒体已完成跳转。
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio =>
        window.__getAssignedSource(audio) === window.__getPlaybackState().audioSrc && !audio.paused && !audio.seeking
        && audio.readyState >= 3 && audio.currentTime >= 30.1), null, { timeout: 45000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-dialogue-active="true"]').length === 2);
    await togglePlayback(page);
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
    const overlapTime = await page.evaluate(() => [...document.querySelectorAll('audio')].find(audio =>
        window.__getAssignedSource(audio) === window.__getPlaybackState().audioSrc).currentTime);
    assert.equal(await mode.locator('[data-dialogue-line]').evaluateAll((nodes, time) => nodes.every(node => Number(node.getAttribute('data-start-time')) <= time), overlapTime), true);
    assert.equal(await mode.locator('[data-dialogue-line] svg, [data-monet-word-sweep]').count(), 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, 'dialogue-desktop.png') });
    const candidate = await mode.locator('[data-dialogue-line]').evaluateAll((nodes, time) => {
        const bounds = document.querySelector('[data-testid="dialogue-scroll"]').getBoundingClientRect();
        const node = nodes.find(node => {
            const rect = node.getBoundingClientRect();
            return Number(node.getAttribute('data-start-time')) < time - 0.2 && rect.top + rect.height / 2 > bounds.top + 20
                && rect.top + rect.height / 2 < bounds.bottom - 20;
        });
        if (!node) throw new Error('No visible played cue available to seek');
        return { index: node.getAttribute('data-dialogue-line'), time: Number(node.getAttribute('data-start-time')) };
    }, overlapTime);
    await mode.locator(`[data-dialogue-line="${candidate.index}"]`).click();
    await page.waitForFunction(time => [...document.querySelectorAll('audio')].some(audio =>
        !audio.paused && !audio.seeking && audio.readyState >= 3 && audio.currentTime > time + 0.1 && Math.abs(audio.currentTime - time) < 1), candidate.time);
    await page.waitForFunction(() => {
        const audio = [...document.querySelectorAll('audio')].find(audio => window.__getAssignedSource(audio) === window.__getPlaybackState().audioSrc);
        return [...document.querySelectorAll('[data-dialogue-line]')].every(node => Number(node.getAttribute('data-start-time')) <= audio.currentTime + 0.05);
    });
    await togglePlayback(page);
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
    const seek = await page.evaluate(() => ({ position: [...document.querySelectorAll('audio')].find(audio =>
        window.__getAssignedSource(audio) === window.__getPlaybackState().audioSrc).currentTime,
        shownStarts: [...document.querySelectorAll('[data-dialogue-line]')].map(node => Number(node.getAttribute('data-start-time'))) }));
    assert.ok(seek.shownStarts.every(time => time <= seek.position + 0.1));
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(400);
    assert.equal(await mode.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: path.join(output, 'dialogue-narrow.png') });
    await page.reload();
    await page.waitForSelector('audio', { state: 'attached' });
    const returnToPlayer = page.locator('button[aria-label="返回播放器"]');
    if (await returnToPlayer.count()) await returnToPlayer.evaluate(button => button.click());
    await mode.waitFor({ timeout: 30000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('visualizer_mode')), 'dialogue');
    const resources = verifyResources(errors, resourceFailures);
    const result = { mode: 'dialogue', overlapCount: 2, clickTarget: candidate.time, seek, persistedMode: true, narrowOverflow: false, ...resources };
    await writeFile(path.join(output, 'dialogue-verification.json'), JSON.stringify(result, null, 2));
    console.log('Fanjiao dialogue verified:', JSON.stringify(result));
}
