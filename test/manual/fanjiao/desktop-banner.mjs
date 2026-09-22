import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyResources } from './desktop-home.mjs';

// 真实 Electron 横幅验证：官方数据、首尾衔接、拖动吸附、防误点和原生触摸。
export async function verifyBanner(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const home = page.getByTestId('online-discovery-home');
    const outer = page.getByTestId('discovery-home-scroll');
    const banner = page.getByTestId('discovery-banner');
    const rail = page.getByTestId('discovery-banner-rail');
    await banner.waitFor({ timeout: 30000 });
    await banner.locator('[data-banner-slide="1"]').focus();
    const response = await page.evaluate(() => window.electron.fanjiaoRequest('homeSections', { limit: 20, offset: 0 }));
    assert.ok(response.ok);
    const items = response.data.items.find(section => section.kind === 'banners').banners;
    assert.ok(items.length > 1);
    assert.deepEqual(await rail.locator('[data-banner-id]:not([data-banner-clone])').evaluateAll(slides => slides.map(slide => slide.dataset.bannerId)), items.map(item => item.id));
    assert.deepEqual(await rail.locator('[data-banner-id]:not([data-banner-clone]) img').evaluateAll(images => images.map(image => image.getAttribute('src'))), items.map(item => item.imageUrl));
    await waitCentered(page, 0);
    await visibleImages(page);
    await page.screenshot({ path: path.join(output, 'banner-desktop.png') });
    const autoplay = await verifyAutoRotation(page, banner, outer);
    await banner.getByRole('button', { name: '下一张横幅', exact: true }).click();
    await waitCentered(page, 1);
    await banner.locator(`[data-banner-dot="${items.length - 1}"]`).click();
    await waitCentered(page, items.length - 1);
    await banner.getByRole('button', { name: '下一张横幅', exact: true }).click();
    await waitCentered(page, 0);
    await banner.getByRole('button', { name: '上一张横幅', exact: true }).click();
    await waitCentered(page, items.length - 1);
    await banner.locator('[data-banner-dot="0"]').click();
    await waitCentered(page, 0);
    const box = await rail.boundingBox();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 16 });
    await page.mouse.up();
    await waitCentered(page, 1);
    assert.equal(await page.evaluate(() => window.__getCollectionState().snapshot?.stack.length || 0), 0);
    await banner.locator('[data-banner-dot="0"]').click();
    await waitCentered(page, 0);
    const stride = await rail.evaluate(el => el.querySelector('[data-banner-slide="1"]').offsetLeft - el.querySelector('[data-banner-slide="0"]').offsetLeft);
    await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160 + stride / 1.5, box.y + box.height / 2, { steps: 16 });
    await page.mouse.up();
    await waitCentered(page, items.length - 1);
    await banner.locator('[data-banner-dot="1"]').click();
    await waitCentered(page, 1);
    // 同一张横幅上的纵向拖动仍交给首页，不把页面滚动误当成切换或打开。
    const horizontal = await rail.evaluate(el => el.scrollLeft);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.ok(await outer.evaluate(el => el.scrollTop) > 100);
    assert.ok(Math.abs(await rail.evaluate(el => el.scrollLeft) - horizontal) < 2);
    await outer.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); el.scrollTop = 0; });
    const focused = rail.locator('[data-banner-slide="2"]');
    await focused.focus();
    await focused.press('ArrowRight');
    await waitCentered(page, 2);
    const target = rail.locator('[data-banner-slide="3"]');
    await target.press('Enter');
    await page.waitForFunction(id => String(window.__getCollectionState().snapshot?.stack.at(-1)?.id) === id, items[2].album.id);
    await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__getCollectionState().snapshot?.stack.length);
    await waitCentered(page, 2);
    await home.getByTestId('discovery-tab-browse').click();
    assert.equal(await page.getByTestId('discovery-banner').count(), 0);
    await home.getByTestId('discovery-tab-recommendations').click();
    await banner.locator('[data-banner-slide="1"]').focus();
    await waitCentered(page, 0);
    await page.setViewportSize({ width: 390, height: 900 });
    await waitCentered(page, 0);
    await visibleImages(page);
    assert.equal(await home.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: path.join(output, 'banner-narrow.png') });
    const touchBox = await rail.boundingBox();
    const session = await page.context().newCDPSession(page);
    const y = touchBox.y + touchBox.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y, id: 0 }] });
    for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - step * 25, y, id: 0 }] });
        await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitCentered(page, 1);
    await session.detach();
    assert.equal(await page.evaluate(() => window.__getCollectionState().snapshot?.stack.length || 0), 0);
    const result = { banners: items.map(item => ({ id: item.id, albumId: item.album.id })), centered: true, dots: true,
        loopBothDirections: true, mouseDrag: true, dragAcrossSeam: true, verticalDrag: true, keyboardOpen: true, touchSwipe: true,
        autoplay, narrowOverflow: false, ...verifyResources(errors, resourceFailures) };
    await writeFile(path.join(output, 'banner-verification.json'), JSON.stringify(result, null, 2));
    console.log('Homepage banner verified:', JSON.stringify(result));
}

async function verifyAutoRotation(page, banner, outer) {
    const current = () => banner.locator('[data-banner-dot][aria-current="true"]').getAttribute('data-banner-dot');
    const leave = async () => {
        await page.getByTestId('discovery-tab-recommendations').focus();
        await page.mouse.move(15, 15);
    };
    await leave();
    const started = Date.now();
    await page.waitForTimeout(4300);
    assert.equal(await current(), '0', 'Autoplay must not advance before five seconds');
    await waitCentered(page, 1);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 4800 && elapsed < 7500, `Unexpected autoplay interval: ${elapsed}ms`);
    const box = await banner.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.waitForTimeout(5300);
    assert.equal(await current(), '1', 'Hover must pause rotation');
    await banner.locator('[data-banner-slide="2"]').focus();
    await page.mouse.move(15, 15);
    await page.waitForTimeout(5300);
    assert.equal(await current(), '1', 'Keyboard focus must pause rotation');
    await leave();
    await outer.evaluate(el => { el.scrollTop = 1000; });
    await page.waitForTimeout(5300);
    assert.equal(await current(), '1', 'Offscreen banners must not keep rotating');
    await outer.evaluate(el => { el.scrollTop = 0; });
    await banner.locator('[data-banner-dot="0"]').click();
    await waitCentered(page, 0);
    return { intervalMs: 5000, firstSettledAfterMs: elapsed, hoverPauses: true, focusPauses: true, offscreenPauses: true };
}

async function waitCentered(page, index) {
    await page.waitForFunction(index => {
        const rail = document.querySelector('[data-testid="discovery-banner-rail"]');
        const slide = rail?.querySelector(`[data-banner-slide="${index + 1}"]`);
        const dot = document.querySelector(`[data-banner-dot="${index}"]`);
        if (!slide || dot?.getAttribute('aria-current') !== 'true') return false;
        const a = rail.getBoundingClientRect(), b = slide.getBoundingClientRect();
        return Math.abs(a.left + a.width / 2 - b.left - b.width / 2) < 1.5;
    }, index);
}

async function visibleImages(page) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="online-discovery-home"] img')]
        .filter(img => { const r = img.getBoundingClientRect(); return r.width && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; }).every(img => img.complete));
}
