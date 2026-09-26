import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyResources } from './desktop-home.mjs';

// 独立桌面配置验证真实历史列表、旧记录补齐、完整队列续播与重新加载。
async function readers(page) {
    await page.waitForSelector('audio', { state: 'attached' });
    await page.evaluate(async () => {
        const url = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(name)).name;
        window.__getPlaybackState = (await import(url('/src/stores/usePlaybackStore.ts'))).usePlaybackStore.getState;
        window.__getEpisodes = (await import(url('/src/stores/useEpisodePlaybackStore.ts'))).useEpisodePlaybackStore.getState;
        window.__getAssignedSource = (await import(url('/src/services/playbackMediaSource.ts'))).getAssignedAudioSource;
    });
}
export async function verifyHistory(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.getByTestId('home-tab-history').click();
    const history = page.getByTestId('episode-history-page');
    await history.getByText('收听广播剧后，记录会显示在这里').waitFor();
    await readers(page);
    const seed = await page.evaluate(async () => {
        const url = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(name)).name;
        const { omni } = await import(url('/src/services/onlineMusic/omni.ts'));
        const { episodeMetadataFromSong } = await import(url('/src/utils/episodeHistory.ts'));
        const ids = ['111726', '111715', '111661', '111706'];
        const queues = await Promise.all(ids.map(id => omni.getCollectionTracks({ providerId: 'fanjiao', id, name: id, type: 'album' }, { limit: 100, offset: 0 })));
        const now = Date.now();
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(12, 0, 0, 0);
        const earlier = new Date(); earlier.setDate(earlier.getDate() - 4);
        const times = [now - 1000, now - 60000, yesterday.getTime(), earlier.getTime()];
        for (let i = 0; i < ids.length; i++) {
            const song = i === 0 ? queues[0].items.find(song => song.id === '120412') : queues[i].items.find(song => song.durationMs > 0);
            if (!song) throw new Error('Missing live fixture episode');
            window.__getEpisodes().saveProgress(`online:fanjiao:${song.id}`, { position: i ? 30 : 90, duration: song.durationMs / 1000,
                completed: false, updatedAt: times[i], ...(i ? { lastPlayedAt: times[i], metadata: episodeMetadataFromSong(song) } : {}) });
        }
        const completed = queues[0].items.find(song => song.id === '120361');
        window.__getEpisodes().saveProgress('online:fanjiao:120361', { position: completed.durationMs / 1000, duration: completed.durationMs / 1000,
            completed: true, updatedAt: earlier.getTime(), metadata: episodeMetadataFromSong(completed) });
        return { albumIds: ids, fullQueue: queues[0].items.map(song => song.id) };
    });
    await history.locator('[data-history-album="111726"]').waitFor({ timeout: 30000 });
    await history.getByRole('status').waitFor({ state: 'hidden' });
    assert.equal(await history.locator('[data-history-album]').count(), 4);
    for (const name of ['今天', '昨天', '更早']) assert.equal(await history.getByRole('heading', { name, exact: true }).count(), 1);
    assert.match(await history.locator('[data-history-album="111726"]').innerText(), /已播放 01:30/);
    const cards = history.locator('[aria-label="今天"] [data-history-album]');
    const desktopBoxes = await cards.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; }));
    assert.equal(desktopBoxes[0].y, desktopBoxes[1].y);
    assert.ok(desktopBoxes[1].x > desktopBoxes[0].x + desktopBoxes[0].width);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="episode-history-page"] img')].every(img => img.complete));
    await page.screenshot({ path: path.join(output, 'history-desktop.png') });
    const trigger = history.locator('[data-history-episodes="111726"]');
    await trigger.click();
    const panel = history.getByTestId('history-episode-panel').getByTestId('side-panel-list');
    await panel.locator('[data-history-episode="120361"]').waitFor();
    assert.match(await panel.locator('[data-history-episode="120361"]').innerText(), /已听完本集/);
    await page.waitForTimeout(400);
    const rows = await panel.locator('[data-history-episode]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    assert.ok(rows[1] >= rows[0] + 83, 'Virtualized rows must not overlap');
    await page.screenshot({ path: path.join(output, 'history-panel.png') });
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(500);
    assert.equal(await history.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    const narrowBoxes = await cards.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
    assert.equal(narrowBoxes[0].x, narrowBoxes[1].x);
    assert.ok(narrowBoxes[1].y > narrowBoxes[0].y);
    await page.screenshot({ path: path.join(output, 'history-narrow.png') });
    await page.setViewportSize({ width: 1100, height: 900 });
    await trigger.click();
    await panel.locator('[data-history-episode="120412"]').click();
    await page.waitForFunction(() => {
        const state = window.__getPlaybackState();
        return state.currentSong?.id === '120412' && [...document.querySelectorAll('audio')].some(audio =>
            window.__getAssignedSource(audio) === state.audioSrc && !audio.paused && audio.readyState >= 3 && audio.currentTime >= 91);
    }, null, { timeout: 45000 });
    const resumed = await page.evaluate(() => ({ queue: window.__getPlaybackState().playQueue.map(song => song.id),
        position: [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime }));
    assert.deepEqual(resumed.queue, seed.fullQueue);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].every(audio => audio.paused));
    await page.locator('button[aria-label="返回主页"]').evaluate(button => button.click());
    await history.waitFor();
    const saved = await page.evaluate(() => window.__getEpisodes().progress['online:fanjiao:120412']);
    assert.ok(saved.position >= 91 && saved.lastPlayedAt > 0,
        `Actual HLS playback must update progress and listening time: ${JSON.stringify({ position: saved.position, lastPlayedAt: saved.lastPlayedAt })}`);
    const beforeReload = saved.position;
    await page.reload();
    await readers(page);
    await history.waitFor({ timeout: 30000 });
    assert.equal(await history.locator('[data-history-album]').count(), 4);
    const restored = await page.evaluate(() => window.__getEpisodes().progress['online:fanjiao:120412']);
    assert.ok(Math.abs(restored.position - beforeReload) < 1);
    assert.ok(restored.metadata.albumName.includes('冬日花火'));
    await page.getByTestId('home-tab-albums').click();
    const continueCard = page.locator('[data-continue-episode="120412"]');
    await continueCard.waitFor();
    assert.match(await continueCard.innerText(), /已播放 01:3/);
    await page.getByTestId('home-tab-history').click();
    await history.locator('[data-history-album="111726"] button').first().click();
    await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await history.waitFor();
    const resources = verifyResources(errors, resourceFailures);
    const result = { albums: seed.albumIds, desktopColumns: 2, narrowColumns: 1, legacyMetadataHydrated: true,
        completedRetained: true, resumed, restoredPosition: restored.position, homepageResumeShared: true, ...resources };
    await writeFile(path.join(output, 'history-verification.json'), JSON.stringify(result, null, 2));
    console.log('Fanjiao history verified:', JSON.stringify(result));
}
