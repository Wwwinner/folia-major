import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// 在独立桌面配置中验证真实发现页、筛选、专辑导航和带完整队列的续播。
export async function verifyHome(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const home = page.getByTestId('online-discovery-home');
    await home.locator('[data-discovery-section]').first().waitFor({ timeout: 30000 });
    await page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/stores/useEpisodePlaybackStore.ts')).name;
        const { useEpisodePlaybackStore } = await import(url);
        useEpisodePlaybackStore.getState().saveProgress('online:fanjiao:120412', {
            position: 90, duration: 3000, completed: false, updatedAt: Date.now(),
        });
    });
    const resume = home.locator('[data-continue-episode="120412"]');
    await resume.waitFor({ timeout: 30000 });
    assert.match(await resume.innerText(), /已播放 01:30/);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="online-discovery-home"] img')]
        .filter(img => { const rect = img.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0; }).every(img => img.complete));
    await page.screenshot({ path: path.join(output, 'home-desktop.png') });
    const initialSections = await home.locator('[data-discovery-section] h2').allTextContents();
    assert.ok(initialSections.length >= 4);
    const firstCard = home.locator('[data-discovery-album]').first();
    const albumId = await firstCard.getAttribute('data-discovery-album');
    await firstCard.click();
    await page.waitForFunction(id => String(window.__getCollectionState().snapshot?.stack.at(-1)?.id) === id, albumId);
    await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__getCollectionState().snapshot?.stack.length);

    await home.getByTestId('discovery-tab-browse').click();
    await home.locator('[data-discovery-album]').first().waitFor();
    for (const [label, option] of [['分类', '广播剧'], ['更新状态', '已完结'], ['价格', '免费']]) {
        await home.locator(`button[aria-haspopup="listbox"][aria-label="${label}"]`).click();
        await page.getByRole('option', { name: option, exact: true }).click();
    }
    await home.getByRole('status').waitFor({ state: 'hidden' });
    await home.locator('[data-discovery-album]').first().waitFor();
    const beforeMore = await home.locator('[data-discovery-album]').count();
    await home.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('[data-testid="online-discovery-home"] [data-discovery-album]').length > count, beforeMore);
    const afterMore = await home.locator('[data-discovery-album]').count();
    await home.getByTestId('discovery-home-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, 'home-browse.png') });

    await home.getByTestId('discovery-tab-rankings').click();
    const rankingPage = home.getByTestId('discovery-ranking-page');
    await rankingPage.locator('[data-ranking-album]').first().waitFor();
    const rankNames = await rankingPage.locator('[data-ranking-tab]').allTextContents();
    assert.equal(rankNames.length, 5);
    await page.screenshot({ path: path.join(output, 'home-rankings.png') });
    await rankingPage.getByTestId('discovery-ranking-back').click();
    await home.getByTestId('discovery-tab-recommendations').click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(700);
    const overflow = await home.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(output, 'home-narrow.png') });
    await page.setViewportSize({ width: 1100, height: 900 });
    await resume.click();
    await page.waitForFunction(() => {
        const state = window.__getPlaybackState();
        return state.currentSong?.id === '120412' && state.playQueue.length >= 18
            && [...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.readyState >= 3 && audio.currentTime >= 90);
    }, null, { timeout: 45000 });
    const resumed = await page.evaluate(() => {
        const state = window.__getPlaybackState();
        return { id: state.currentSong.id, queue: state.playQueue.map(song => song.id), position: [...document.querySelectorAll('audio')].find(audio => !audio.paused).currentTime };
    });
    await page.keyboard.press('Space');
    const { runtimeErrors, failedImages, unsupportedProbes } = verifyResources(errors, resourceFailures);
    const result = { initialSections, openedAlbum: albumId, beforeMore, afterMore, rankNames, narrowOverflow: overflow, resumed, runtimeErrors, failedImages, unsupportedProbes };
    await writeFile(path.join(output, 'home-verification.json'), JSON.stringify(result, null, 2));
    console.log('Fanjiao home verified:', JSON.stringify(result));
}

export async function verifyPopular(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const home = page.getByTestId('online-discovery-home');
    const trigger = home.getByRole('button', { name: '查看热门速递全部内容', exact: true });
    await trigger.waitFor({ timeout: 30000 });
    const homeScroll = home.getByTestId('discovery-home-scroll');
    const homePosition = await homeScroll.evaluate(el => el.scrollTop);
    await trigger.click();
    const section = home.getByTestId('discovery-section-page');
    const rows = section.locator('[data-discovery-list-album]');
    await rows.first().waitFor({ timeout: 30000 });
    const response = await page.evaluate(() => window.electron.fanjiaoRequest('sectionAlbums', { id: 'popular', limit: 20, offset: 0 }));
    assert.ok(response.ok);
    assert.deepEqual(await rows.evaluateAll(items => items.map(item => item.dataset.discoveryListAlbum)), response.data.items.map(album => album.id));
    assert.ok(response.data.total > response.data.items.length);
    const description = await rows.first().locator('[data-album-description]').textContent();
    assert.ok(description.trim().length > 0);
    assert.ok(response.data.items[0].description.trimStart().startsWith(description));
    assert.ok(description.split(/\r?\n/).every(line => line.trim().length > 0), 'Description must not include another paragraph');
    assert.ok((await rows.first().locator('[data-album-update]').textContent()).includes(response.data.items[0].latestEpisodeName));
    const sale = response.data.items.find(album => album.promotionLabel);
    if (sale) assert.ok((await section.locator(`[data-discovery-list-album="${sale.id}"]`).innerText()).includes(sale.promotionLabel));
    await section.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-discovery-list-album]').length === 40);
    const scroller = page.getByTestId('discovery-section-scroll');
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="discovery-section-page"] img')]
        .filter(img => img.getBoundingClientRect().top < innerHeight).every(img => img.complete));
    await page.screenshot({ path: path.join(output, 'popular-desktop.png') });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(1600);
    assert.equal(await section.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: path.join(output, 'popular-narrow.png') });
    await page.setViewportSize({ width: 1100, height: 900 });
    const target = rows.nth(25);
    await target.scrollIntoViewIfNeeded();
    const position = await scroller.evaluate(el => el.scrollTop);
    const albumId = await target.getAttribute('data-discovery-list-album');
    await target.click();
    await page.waitForFunction(id => String(window.__getCollectionState().snapshot?.stack.at(-1)?.id) === id, albumId);
    await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__getCollectionState().snapshot?.stack.length);
    assert.equal(await rows.count(), 40);
    assert.ok(Math.abs(await scroller.evaluate(el => el.scrollTop) - position) < 2);
    await page.getByTestId('discovery-section-back').click();
    await trigger.waitFor();
    assert.ok(Math.abs(await homeScroll.evaluate(el => el.scrollTop) - homePosition) < 2);
    assert.ok(await home.locator('[data-discovery-section]').filter({ has: page.getByRole('heading', { name: '热播有声', exact: true }) }).getByTestId('horizontal-scroll-row').isVisible());
    const result = { total: response.data.total, loaded: 40, albumId, narrowOverflow: false, scrollRestored: true, ...verifyResources(errors, resourceFailures) };
    await writeFile(path.join(output, 'popular-verification.json'), JSON.stringify(result, null, 2));
    console.log('Popular section verified:', JSON.stringify(result));
}

export function verifyResources(errors, resourceFailures) {
    // 远端失效封面已有图标兜底；其 HTTP 报错与脚本、目录和音频失败分开核对。
    const failedImages = resourceFailures.filter(entry => entry.type === 'image');
    // QQ 旧后端的通道能力探测按既有约定允许 404，与饭角首页无关。
    const unsupportedProbes = resourceFailures.filter(entry => entry.status === 404 && entry.path === '/login/channels'
        && /^127\.0\.0\.1:\d+$/.test(entry.host));
    const expectedFailures = new Set([...failedImages, ...unsupportedProbes]);
    const unexpectedResources = resourceFailures.filter(entry => !expectedFailures.has(entry));
    const runtimeErrors = errors.filter(message => ![...expectedFailures].some(entry => message.startsWith('Failed to load resource:') && message.includes(`status of ${entry.status}`)));
    assert.deepEqual(unexpectedResources, []);
    assert.deepEqual(runtimeErrors, []);
    return { runtimeErrors, failedImages, unsupportedProbes };
}
