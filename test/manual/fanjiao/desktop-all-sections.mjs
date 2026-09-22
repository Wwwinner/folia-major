import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyResources } from './desktop-home.mjs';

// 复用正式首页与栏目页，逐一验证 13 个更多入口、分页顺序和返回位置。
export async function verifyAllSections(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const home = page.getByTestId('online-discovery-home');
    const homeScroll = home.getByTestId('discovery-home-scroll');
    await home.locator('[data-discovery-section]').first().waitFor({ timeout: 30000 });
    const sections = [];
    let offset = 0;
    do {
        const response = await page.evaluate(offset => window.electron.fanjiaoRequest('homeSections', { limit: 20, offset }), offset);
        assert.ok(response.ok);
        sections.push(...response.data.items.filter(section => section.kind === 'albums' && section.moreId));
        if (!response.data.hasMore) break;
        offset = response.data.nextOffset;
    } while (offset < 100);
    assert.deepEqual(sections.map(section => section.moreId).sort(), [
        'popular', 'weekly', 'audiobooks', 'discounts', 'music', 'new-releases', 'romance',
        'historical', 'angst', 'sweet', 'scenarios', 'free', 'one-shot',
    ].sort());
    const moreButtons = homeScroll.locator('[data-discovery-section]').getByRole('button', { name: /^查看.+全部内容$/ });
    while (await moreButtons.count() < sections.length) {
        const before = await moreButtons.count();
        await homeScroll.getByRole('button', { name: '加载更多', exact: true }).click();
        await page.waitForFunction(before => [...document.querySelectorAll('[data-discovery-section] button')]
            .filter(button => /^查看.+全部内容$/.test(button.getAttribute('aria-label') || '')).length > before, before);
    }
    assert.equal(await moreButtons.count(), 13);
    const results = [];
    for (const section of sections) {
        const trigger = home.locator(`[data-discovery-section="${section.id}"]`).getByRole('button', { name: `查看${section.title}全部内容`, exact: true });
        await trigger.scrollIntoViewIfNeeded();
        await trigger.focus();
        // Browser/Playwright may scroll a focused edge button again while positioning the click.
        await homeScroll.evaluate(el => el.addEventListener('click', () => { el.dataset.entryScroll = String(el.scrollTop); }, { capture: true, once: true }));
        await trigger.click();
        const homePosition = await homeScroll.evaluate(el => Number(el.dataset.entryScroll));
        const detail = page.getByTestId('discovery-section-page');
        const rows = detail.locator('[data-discovery-list-album]');
        const first = await page.evaluate(id => window.electron.fanjiaoRequest('sectionAlbums', { id, limit: 20, offset: 0 }), section.moreId);
        assert.ok(first.ok, `${section.title}: first page failed`);
        const firstIds = first.data.items.map(album => album.id);
        await waitIds(page, firstIds);
        assert.equal(await detail.locator('h2').textContent(), section.title);
        let expectedIds = firstIds;
        if (first.data.hasMore) {
            await detail.getByRole('button', { name: '加载更多', exact: true }).click();
            const next = await page.evaluate(({ id, offset }) => window.electron.fanjiaoRequest('sectionAlbums', { id, limit: 20, offset }),
                { id: section.moreId, offset: first.data.nextOffset });
            assert.ok(next.ok, `${section.title}: second page failed`);
            expectedIds = [...new Set([...firstIds, ...next.data.items.map(album => album.id)])];
            await waitIds(page, expectedIds);
        } else assert.equal(await detail.getByRole('button', { name: '加载更多', exact: true }).count(), 0);
        const scroller = detail.getByTestId('discovery-section-scroll');
        await scroller.evaluate(el => { el.scrollTop = 0; });
        if (['weekly', 'discounts'].includes(section.moreId)) {
            await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="discovery-section-page"] img')]
                .filter(img => { const r = img.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }).every(img => img.complete));
            await page.screenshot({ path: path.join(output, `more-${section.moreId}.png`) });
            if (expectedIds.length) {
                const albumId = await rows.first().getAttribute('data-discovery-list-album');
                await rows.first().click();
                await page.waitForFunction(id => String(window.__getCollectionState().snapshot?.stack.at(-1)?.id) === id, albumId);
                await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
                await page.keyboard.press('Escape');
                await page.waitForFunction(() => !window.__getCollectionState().snapshot?.stack.length);
                await waitIds(page, expectedIds);
            }
        }
        await detail.getByTestId('discovery-section-back').click();
        await trigger.waitFor();
        const restoredPosition = await homeScroll.evaluate(el => el.scrollTop);
        assert.ok(Math.abs(restoredPosition - homePosition) < 2, `${section.title}: home position lost (${homePosition} -> ${restoredPosition})`);
        const result = { id: section.moreId, title: section.title, total: first.data.total, loaded: expectedIds.length, secondPage: first.data.hasMore };
        results.push(result);
        console.log('Section verified:', JSON.stringify(result));
    }
    const report = { sections: results, ...verifyResources(errors, resourceFailures) };
    await writeFile(path.join(output, 'all-sections-verification.json'), JSON.stringify(report, null, 2));
    console.log('All 13 section entries verified.');
}

async function waitIds(page, ids) {
    await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-discovery-list-album]')]
        .map(item => item.dataset.discoveryListAlbum)) === JSON.stringify(expected), ids, { timeout: 30000 });
}
