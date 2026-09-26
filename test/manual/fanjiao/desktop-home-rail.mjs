import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyResources } from './desktop-home.mjs';
import { verifyHomeScrollbar } from './desktop-home-scrollbar.mjs';

// 真实 Electron 首页横滑验证：完整条数、拖动惯性、防误触、滚轮方向与触屏原生滚动。
export async function verifyHomeRail(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const home = page.getByTestId('online-discovery-home');
    const outer = home.getByTestId('discovery-home-scroll');
    const section = home.locator('[data-discovery-section]').filter({ has: page.getByRole('heading', { name: '热门速递', exact: true }) });
    const rail = section.getByTestId('horizontal-scroll-row');
    const cards = rail.locator('[data-discovery-album]');
    await cards.first().waitFor({ timeout: 30000 });
    const scrollbar = await verifyHomeScrollbar(page, output, outer);
    const response = await page.evaluate(() => window.electron.fanjiaoRequest('homeSections', { limit: 20, offset: 0 }));
    assert.ok(response.ok);
    const homeSections = [...response.data.items];
    if (response.data.hasMore) {
        await outer.getByRole('button', { name: '加载更多', exact: true }).click();
        const next = await page.evaluate(offset => window.electron.fanjiaoRequest('homeSections', { limit: 20, offset }), response.data.nextOffset);
        assert.ok(next.ok);
        homeSections.push(...next.data.items);
        await home.locator(`[data-discovery-section="${next.data.items[0].id}"]`).waitFor();
    }
    const weekly = homeSections.find(item => item.layout === 'landscape-grid');
    assert.ok(weekly, 'Weekly section must declare its landscape layout');
    const weeklySection = home.locator(`[data-discovery-section="${weekly.id}"]`);
    const weeklyCards = weeklySection.locator('[data-discovery-album]');
    assert.deepEqual(await weeklyCards.evaluateAll(items => items.map(item => item.dataset.discoveryAlbum)), weekly.items.map(item => item.id));
    assert.deepEqual(await weeklyCards.locator('img').evaluateAll(images => images.map(img => img.getAttribute('src'))), weekly.items.map(item => item.landscapeCoverUrl));
    const checkWeeklyLayout = async columns => {
        const layout = await weeklyCards.evaluateAll(items => ({
            columns: new Set(items.map(item => Math.round(item.getBoundingClientRect().left))).size,
            rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size,
            ratios: items.map(item => { const r = item.querySelector('img').getBoundingClientRect(); return r.width / r.height; }),
        }));
        assert.equal(layout.columns, columns);
        assert.equal(layout.rows, Math.ceil(weekly.items.length / columns));
        assert.ok(layout.ratios.every(ratio => Math.abs(ratio - 2) < 0.02));
        assert.equal(await weeklySection.getByTestId('horizontal-scroll-row').count(), 0);
    };
    await checkWeeklyLayout(3);
    await weeklySection.scrollIntoViewIfNeeded();
    await page.waitForFunction(id => [...document.querySelectorAll(`[data-discovery-section="${id}"] img`)].every(img => img.complete && img.naturalWidth > img.naturalHeight), weekly.id);
    await weeklySection.screenshot({ path: path.join(output, 'weekly-desktop.png') });
    const summaries = ['new-releases', 'romance', 'angst', 'scenarios'].map(id => {
        const section = homeSections.find(item => item.moreId === id);
        assert.ok(section, `Missing summary section: ${id}`);
        return section;
    });
    const checkSummaryLayout = async (columns, data) => {
        const section = home.locator(`[data-discovery-section="${data.id}"]`);
        const layout = await section.locator('[data-discovery-album]').evaluateAll(items => ({
            columns: new Set(items.map(item => Math.round(item.getBoundingClientRect().left))).size,
            rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size,
            coverWidths: items.map(item => item.querySelector('img').getBoundingClientRect().width),
            ids: items.map(item => item.dataset.discoveryAlbum),
        }));
        assert.equal(layout.columns, columns);
        assert.equal(layout.rows, Math.ceil(data.items.length / columns));
        assert.deepEqual(layout.ids, data.items.map(item => item.id));
        assert.ok(layout.coverWidths.every(width => Math.abs(width - 115.2) < 1));
        assert.equal(await section.getByTestId('horizontal-scroll-row').count(), 0);
    };
    for (const summary of summaries) {
        const block = home.locator(`[data-discovery-section="${summary.id}"]`);
        await block.scrollIntoViewIfNeeded();
        await page.waitForFunction(id => [...document.querySelectorAll(`[data-discovery-section="${id}"] img`)].every(img => img.complete && img.naturalWidth > 0), summary.id);
        await checkSummaryLayout(3, summary);
        await block.screenshot({ path: path.join(output, `${summary.moreId}-desktop.png`) });
    }
    await outer.evaluate(el => { el.scrollTop = 0; });
    const expected = response.data.items.find(item => item.title === '热门速递');
    assert.deepEqual(await cards.evaluateAll(items => items.map(item => item.dataset.discoveryAlbum)), expected.items.map(item => item.id));
    assert.ok(await rail.evaluate(el => el.scrollWidth > el.clientWidth));
    assert.equal(await rail.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    assert.equal(await outer.evaluate(el => getComputedStyle(el, '::-webkit-scrollbar').width), '10px');
    assert.equal(await cards.evaluateAll(items => new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size), 1);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="horizontal-scroll-row"] img')]
        .filter(img => { const r = img.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; }).every(img => img.complete));
    await page.screenshot({ path: path.join(output, 'home-rail-desktop.png') });
    const drag = async () => {
        const box = await rail.boundingBox();
        await rail.evaluate(el => el.addEventListener('pointerup', () => { el.dataset.releaseScroll = String(el.scrollLeft); }, { once: true, capture: true }));
        await page.mouse.move(box.x + box.width * 0.7, box.y + 55);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.2, box.y + 55, { steps: 16 });
        await page.mouse.up();
        return rail.evaluate(el => Number(el.dataset.releaseScroll));
    };
    const dragged = await drag();
    assert.ok(dragged > 100);
    await page.waitForTimeout(200);
    const coasted = await rail.evaluate(el => el.scrollLeft);
    assert.ok(coasted > dragged + 2, 'Mouse release should coast');
    assert.ok(await outer.evaluate(el => el.scrollTop) < 2, 'Horizontal drag must not move the page');
    assert.equal(await page.evaluate(() => window.__getCollectionState().snapshot?.stack.length || 0), 0, 'Drag must not open a collection');
    // A new press must stop momentum without cancelling a later intentional click.
    const box = await rail.boundingBox();
    const gapX = await cards.evaluateAll(items => {
        const rail = items[0].parentElement.getBoundingClientRect();
        return items.map(item => item.getBoundingClientRect()).find(rect => rect.right > rail.left + 10 && rect.right < rail.right - 20).right + 8;
    });
    await page.mouse.move(gapX, box.y + 50);
    await page.mouse.down();
    const stopped = await rail.evaluate(el => el.scrollLeft);
    await page.waitForTimeout(120);
    assert.ok(Math.abs(await rail.evaluate(el => el.scrollLeft) - stopped) < 2);
    await page.mouse.up();
    // Starting on a cover must hand a vertical gesture to the parent, with no sideways movement.
    const horizontalBeforeVerticalDrag = await rail.evaluate(el => el.scrollLeft);
    await page.mouse.move(box.x + 50, box.y + 110);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y - 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const verticalDragged = await outer.evaluate(el => el.scrollTop);
    assert.ok(verticalDragged > 150, 'Dragging a cover vertically must scroll the home page');
    assert.ok(Math.abs(await rail.evaluate(el => el.scrollLeft) - horizontalBeforeVerticalDrag) < 2, 'Vertical drag must not move the row');
    assert.equal(await page.evaluate(() => window.__getCollectionState().snapshot?.stack.length || 0), 0, 'Vertical drag must not open a collection');
    await outer.press('Escape');
    await outer.evaluate(el => { el.scrollTop = 0; });
    await page.mouse.move(box.x + 50, box.y + 50);
    const verticalBefore = await outer.evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(300);
    assert.ok(await outer.evaluate(el => el.scrollTop) > verticalBefore + 20, 'Vertical wheel must scroll the home page');
    await outer.evaluate(el => { el.scrollTop = 0; });
    await rail.evaluate(el => { el.scrollLeft = 0; });
    const wheelBox = await rail.boundingBox();
    await page.mouse.move(wheelBox.x + 60, wheelBox.y + 40);
    await page.mouse.wheel(220, 0);
    await page.waitForTimeout(250);
    assert.ok(await rail.evaluate(el => el.scrollLeft) > 100, 'Horizontal wheel must scroll the row');
    assert.ok(await outer.evaluate(el => el.scrollTop) < 2);
    const keyboardCard = cards.nth(10);
    await keyboardCard.focus();
    const albumId = await keyboardCard.getAttribute('data-discovery-album');
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => String(window.__getCollectionState().snapshot?.stack.at(-1)?.id) === id, albumId);
    await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__getCollectionState().snapshot?.stack.length);
    const saved = await rail.evaluate(el => el.scrollLeft);
    await section.getByRole('button', { name: '查看热门速递全部内容', exact: true }).click();
    await page.getByTestId('discovery-section-page').locator('[data-discovery-list-album]').first().waitFor();
    const moreScroll = page.getByTestId('discovery-section-scroll');
    assert.equal(await moreScroll.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    const moreBox = await moreScroll.boundingBox();
    await page.mouse.move(moreBox.x + 100, moreBox.y + 220);
    await page.mouse.down();
    await page.mouse.move(moreBox.x + 100, moreBox.y + 50, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.ok(await moreScroll.evaluate(el => el.scrollTop) > 150, 'More list must support vertical dragging');
    assert.equal(await page.evaluate(() => window.__getCollectionState().snapshot?.stack.length || 0), 0);
    await page.getByTestId('discovery-section-back').click();
    assert.ok(Math.abs(await rail.evaluate(el => el.scrollLeft) - saved) < 2, 'More/back must retain the row position');
    await rail.evaluate(el => { el.scrollLeft = 0; });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(1600);
    assert.equal(await home.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await checkWeeklyLayout(2);
    await weeklySection.screenshot({ path: path.join(output, 'weekly-narrow.png') });
    for (const summary of summaries) {
        await checkSummaryLayout(1, summary);
        await home.locator(`[data-discovery-section="${summary.id}"]`).screenshot({ path: path.join(output, `${summary.moreId}-narrow.png`) });
    }
    await page.setViewportSize({ width: 800, height: 900 });
    for (const summary of summaries) await checkSummaryLayout(2, summary);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(1600);
    await outer.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, 'home-rail-narrow.png') });
    const touchBox = await rail.boundingBox();
    const session = await page.context().newCDPSession(page);
    const y = touchBox.y + 55;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 310, y, id: 0 }] });
    for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 310 - step * 24, y, id: 0 }] });
        await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    const touchScroll = await rail.evaluate(el => el.scrollLeft);
    assert.ok(touchScroll > 80, 'Native touch swipe must move the row');
    assert.equal(await page.evaluate(() => window.__getCollectionState().snapshot?.stack.length || 0), 0);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y + 55, id: 0 }] });
    for (let step = 1; step <= 6; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y + 55 - step * 20, id: 0 }] });
        await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    assert.ok(await outer.evaluate(el => el.scrollTop) > 50, 'Native vertical swipe over a row must scroll the home page');
    await session.detach();
    const result = { count: expected.items.length, weeklyCount: weekly.items.length, weeklyLandscape: true, summarySections: summaries.map(item => item.moreId), dragged, coasted, verticalDragged, touchScroll, keyboardOpen: albumId,
        scrollbar, hiddenHorizontalScrollbars: true, verticalTouch: true, moreVerticalDrag: true, savedPosition: true,
        verticalWheel: true, horizontalWheel: true, narrowOverflow: false, ...verifyResources(errors, resourceFailures) };
    await writeFile(path.join(output, 'home-rail-verification.json'), JSON.stringify(result, null, 2));
    console.log('Home horizontal rows verified:', JSON.stringify(result));
}
