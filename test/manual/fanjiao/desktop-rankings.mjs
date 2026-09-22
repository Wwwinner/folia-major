import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyResources } from './desktop-home.mjs';

// 真实 Electron 验证五个榜单的预览、分页、专辑导航及不发请求的总榜占位。
const ids = ['ranking-feeding', 'ranking-followers', 'ranking-popularity', 'ranking-new', 'ranking-free'];
export async function verifyRankings(page, output, errors, resourceFailures) {
    await page.setViewportSize({ width: 1100, height: 900 });
    const home = page.getByTestId('online-discovery-home');
    const homeScroll = home.getByTestId('discovery-home-scroll');
    const preview = home.getByTestId('discovery-ranking-preview');
    await preview.waitFor({ timeout: 30000 });
    assert.deepEqual(await preview.locator('[data-ranking-tab]').evaluateAll(tabs => tabs.map(tab => tab.dataset.rankingTab)), ids);
    for (const id of ids) {
        await preview.locator(`[data-ranking-tab="${id}"]`).click();
        assert.equal(await preview.locator('[data-ranking-album]').count(), 3);
    }
    await preview.locator('[data-ranking-tab="ranking-feeding"]').click();
    await preview.scrollIntoViewIfNeeded();
    await visibleImages(page);
    await preview.screenshot({ path: path.join(output, 'ranking-home.png') });
    await page.setViewportSize({ width: 390, height: 900 });
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await preview.screenshot({ path: path.join(output, 'ranking-home-narrow.png') });
    await page.setViewportSize({ width: 1100, height: 900 });
    await homeScroll.evaluate(el => el.addEventListener('click', () => { el.dataset.entryScroll = String(el.scrollTop); }, { capture: true, once: true }));
    await preview.getByRole('button', { name: '查看投喂榜全部内容', exact: true }).click();
    const homePosition = await homeScroll.evaluate(el => Number(el.dataset.entryScroll));
    const detail = home.getByTestId('discovery-ranking-page');
    const scroll = detail.getByTestId('discovery-ranking-scroll');
    const rows = detail.locator('[data-ranking-album]');
    const results = [];
    for (const id of ids) {
        await detail.locator(`[data-ranking-tab="${id}"]`).click();
        const first = await page.evaluate(id => window.electron.fanjiaoRequest('sectionAlbums', { id, limit: 20, offset: 0 }), id);
        assert.ok(first.ok, `${id}: first page failed`);
        await waitRows(page, first.data.items);
        assert.ok(first.data.items.every(album => album.ranking?.metric));
        if (id === 'ranking-feeding') {
            await visibleImages(page);
            await page.screenshot({ path: path.join(output, 'ranking-desktop.png') });
            // 只观察正式 Omni 调用次数，确保总榜不以月榜内容或请求冒充。
            await page.evaluate(async () => {
                const moduleUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/services/onlineMusic/omni.ts')).name;
                const { omni } = await import(moduleUrl);
                window.__rankingOmni = omni;
                window.__rankingOriginal = omni.getDiscoverySectionCollections;
                window.__rankingPeriodCalls = 0;
                omni.getDiscoverySectionCollections = (...args) => { window.__rankingPeriodCalls++; return window.__rankingOriginal(...args); };
            });
            try {
                await detail.locator('[data-ranking-period="total"]').click();
                await detail.getByTestId('ranking-total-placeholder').waitFor();
                assert.equal(await rows.count(), 0);
                assert.equal(await detail.getByText('往期榜单').count(), 0);
                await page.screenshot({ path: path.join(output, 'ranking-total-placeholder.png') });
                await detail.locator('[data-ranking-period="month"]').click();
                await waitRows(page, first.data.items);
                assert.equal(await page.evaluate(() => window.__rankingPeriodCalls), 0);
            } finally {
                await page.evaluate(async () => {
                    window.__rankingOmni.getDiscoverySectionCollections = window.__rankingOriginal;
                    delete window.__rankingOmni; delete window.__rankingOriginal; delete window.__rankingPeriodCalls;
                });
            }
            await page.setViewportSize({ width: 390, height: 900 });
            await page.waitForTimeout(500);
            assert.equal(await detail.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
            await visibleImages(page);
            await page.screenshot({ path: path.join(output, 'ranking-narrow.png') });
            await page.setViewportSize({ width: 1100, height: 900 });
        }
        let items = first.data.items;
        if (first.data.hasMore) {
            await detail.getByRole('button', { name: '加载更多', exact: true }).click();
            const next = await page.evaluate(({ id, offset }) => window.electron.fanjiaoRequest('sectionAlbums', { id, limit: 20, offset }),
                { id, offset: first.data.nextOffset });
            assert.ok(next.ok, `${id}: second page failed`);
            items = [...new Map([...items, ...next.data.items].map(album => [album.id, album])).values()];
            await waitRows(page, items);
        }
        results.push({ id, loaded: items.length, total: first.data.total, ranks: [items[0].ranking.position, items.at(-1).ranking.position] });
        console.log('Ranking verified:', JSON.stringify(results.at(-1)));
    }
    const target = rows.nth(25);
    await target.scrollIntoViewIfNeeded();
    const albumId = await target.getAttribute('data-ranking-album');
    await scroll.evaluate(el => el.addEventListener('click', () => { el.dataset.entryScroll = String(el.scrollTop); }, { capture: true, once: true }));
    await target.click();
    const position = await scroll.evaluate(el => Number(el.dataset.entryScroll));
    await page.waitForFunction(id => String(window.__getCollectionState().snapshot?.stack.at(-1)?.id) === id, albumId);
    await page.getByRole('button', { name: '查看曲目', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__getCollectionState().snapshot?.stack.length);
    assert.equal(await rows.count(), results.at(-1).loaded);
    assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - position) < 2);
    await detail.getByTestId('discovery-ranking-back').click();
    await preview.waitFor();
    assert.ok(Math.abs(await homeScroll.evaluate(el => el.scrollTop) - homePosition) < 2);
    assert.equal(await preview.locator('[data-ranking-tab="ranking-free"]').getAttribute('aria-pressed'), 'true');
    await verifyRankingStates(page);
    const result = { charts: results, totalPlaceholder: true, narrowOverflow: false, albumId, scrollRestored: true,
        controlledStates: { lateResponseIgnored: true, repeatedPageStops: true, errorRetry: true, emptyPage: true }, ...verifyResources(errors, resourceFailures) };
    await writeFile(path.join(output, 'rankings-verification.json'), JSON.stringify(result, null, 2));
    console.log('Rankings verified:', JSON.stringify(result));
}

// 在同一正式界面注入可控 Omni 响应，独立核验迟到响应、重复页和失败重试。
async function verifyRankingStates(page) {
    await page.evaluate(async () => {
        const moduleUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/services/onlineMusic/omni.ts')).name;
        const { omni } = await import(moduleUrl);
        window.__rankingOmni = omni;
        window.__rankingOriginal = omni.getDiscoverySectionCollections;
        let feedingCalls = 0;
        omni.getDiscoverySectionCollections = async (id, options) => {
            if (id === 'ranking-feeding') {
                feedingCalls++;
                if (feedingCalls === 1) return new Promise(resolve => { window.__releaseRanking = () => resolve({ items: [], hasMore: false, nextOffset: 20 }); });
                if (feedingCalls === 2) throw new Error('Controlled chart failure');
                return { items: [], hasMore: false, nextOffset: 20 };
            }
            if (id === 'ranking-followers') return { items: [{ id: '999880', providerId: 'fanjiao', type: 'album', name: 'Ranking state fixture',
                ranking: { position: 1, value: 0, metric: 'followers' } }], hasMore: true, nextOffset: options.offset + 20 };
            return window.__rankingOriginal(id, options);
        };
    });
    try {
        await page.getByTestId('discovery-tab-rankings').click();
        const detail = page.getByTestId('discovery-ranking-page');
        await detail.locator('[data-ranking-tab="ranking-feeding"]').click();
        await page.waitForFunction(() => typeof window.__releaseRanking === 'function');
        await detail.locator('[data-ranking-tab="ranking-followers"]').click();
        const fixture = detail.locator('[data-ranking-album="999880"]');
        await fixture.waitFor();
        await page.evaluate(async () => { window.__releaseRanking(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        assert.equal(await fixture.count(), 1);
        await detail.getByRole('button', { name: '加载更多', exact: true }).click();
        await detail.getByRole('button', { name: '加载更多', exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await fixture.count(), 1);
        await detail.locator('[data-ranking-tab="ranking-feeding"]').click();
        await detail.getByRole('alert').waitFor();
        await detail.getByRole('button', { name: '重试', exact: true }).click();
        await detail.getByText('暂无可展示的内容', { exact: true }).waitFor();
        assert.equal(await detail.getByRole('alert').count(), 0);
        assert.equal(await detail.locator('[data-ranking-album]').count(), 0);
    } finally {
        await page.evaluate(async () => {
            window.__rankingOmni.getDiscoverySectionCollections = window.__rankingOriginal;
            delete window.__rankingOmni; delete window.__rankingOriginal; delete window.__releaseRanking;
        });
        await page.getByTestId('discovery-ranking-back').click();
    }
}

async function waitRows(page, items) {
    await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-testid="discovery-ranking-page"] [data-ranking-album]')]
        .map(row => [row.dataset.rankingAlbum, Number(row.dataset.rankingPosition)])) === JSON.stringify(expected),
    items.map(album => [album.id, album.ranking.position]), { timeout: 30000 });
}

async function visibleImages(page) {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-ranking-album] img')]
        .filter(img => { const r = img.getBoundingClientRect(); return r.width && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; }).every(img => img.complete));
}
