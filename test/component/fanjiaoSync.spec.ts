import { test, expect } from './fixtures';

// Verify one-click history sync, the shared action row, actionable errors and history deletion.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('folia_sync_config_v1', JSON.stringify({ provider: 'sync-server', enabled: true, workerBaseUrl: 'https://sync.example.com', authToken: 'fixture-token', fanjiaoHistory: false, fanjiaoPreference: false }));
        localStorage.setItem('folia_episode_progress_v1', JSON.stringify({ 'online:fanjiao:1': {
            position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90,
            metadata: { name: 'Episode one', albumId: '7', albumName: 'Drama', author: 'Studio', coverUrl: '', kind: 'main' },
        } }));
    });
});

test('syncs history with one click from the rightmost action without category controls', async ({ page, mount }, testInfo) => {
    const calls: string[] = [];
    await page.route('https://sync.example.com/**', async route => {
        const request = route.request(); calls.push(`${request.method()} ${new URL(request.url()).pathname}`);
        const body = request.url().endsWith('/health') ? { ok: true, capabilities: { fanjiaoSync: 1 } }
            : request.method() === 'POST' ? { ok: true, protocol: 1 }
                : { protocol: 1, history: { epoch: { counter: 0, device: '' }, records: [] }, cursor: null };
        await route.fulfill({ json: body });
    });
    const root = await mount('fanjiaoSync');
    const section = root.locator('[data-settings-anchor="r2Sync"]');
    await expect(section.getByRole('checkbox')).toHaveCount(0);
    await expect(section.getByText('Playback preference', { exact: true })).toHaveCount(0);
    const buttons = section.getByTestId('sync-actions').getByRole('button');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(2)).toHaveText('Sync Fanjiao data');
    const layout = await buttons.evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
    expect(layout[2].x).toBeGreaterThan(layout[1].x);
    expect(layout[2].y).toBe(layout[0].y);
    await expect(buttons.nth(2)).not.toHaveCSS('color', await buttons.nth(1).evaluate(element => getComputedStyle(element).color));
    await expect(buttons.nth(2)).toBeEnabled();
    await section.getByRole('button', { name: 'Sync Fanjiao data' }).click();
    await expect(section.getByRole('status')).toContainText('Fanjiao sync completed');
    expect(calls).toEqual(['GET /health', 'POST /fanjiao/history', 'GET /fanjiao/history']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folia_episode_progress_v1')!)['online:fanjiao:1'].position)).toBe(627);
    await section.screenshot({ path: testInfo.outputPath('sync-desktop.png') });
});

test('shows an upgrade hint for an old server and fits a narrow window', async ({ page, mount }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('https://sync.example.com/**', route => route.fulfill({ json: { ok: true, schemaVersion: 1 } }));
    const root = await mount('fanjiaoSync');
    await root.getByRole('button', { name: 'Sync Fanjiao data' }).click();
    const section = root.locator('[data-settings-anchor="r2Sync"]');
    await expect(section.getByRole('status')).toContainText('Update your sync server');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await section.screenshot({ path: testInfo.outputPath('sync-mobile.png') });
});

test('confirms history clearing and persists a clear operation without playing media', async ({ page, mount }) => {
    const root = await mount('fanjiaoSync');
    await root.getByRole('button', { name: 'Listening history', exact: true }).click();
    await root.getByRole('button', { name: 'Clear Fanjiao history' }).click();
    const dialog = page.locator('[data-folia-keyboard-window]').filter({ has: page.getByRole('heading', { name: 'Clear Fanjiao history', exact: true }) });
    await expect(dialog).toContainText('other devices');
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(root.getByText('Drama', { exact: true })).toBeVisible();
    await root.getByRole('button', { name: 'Clear Fanjiao history' }).click();
    await dialog.getByRole('button', { name: /confirm/i }).click();
    await expect(root.getByText('Drama', { exact: true })).toHaveCount(0);
    const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('folia_fanjiao_sync_v1')!));
    expect(journal.data.history.records).toEqual([]);
    expect(journal.data.history.epoch.counter).toBeGreaterThan(0);
});

test('deletes one episode through the history side panel', async ({ page, mount }) => {
    const root = await mount('fanjiaoSync');
    await root.getByRole('button', { name: 'Listening history', exact: true }).click();
    await root.getByRole('button', { name: 'Episode history', exact: true }).click();
    await root.getByRole('button', { name: 'Delete Episode one from history', exact: true }).click();
    const dialog = page.locator('[data-folia-keyboard-window]').filter({ has: page.getByRole('heading', { name: 'Delete listening record', exact: true }) });
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(root.getByText('Drama', { exact: true })).toHaveCount(0);
    const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('folia_fanjiao_sync_v1')!));
    expect(journal.data.history.records[0]).toMatchObject({ key: 'online:fanjiao:1', deleted: true, value: null });
});

test('shows a storage error before uploading when the server config cannot be saved', async ({ page, mount }) => {
    const root = await mount('fanjiaoSync');
    const section = root.locator('[data-settings-anchor="r2Sync"]');
    await section.locator('input[type="url"]').fill('https://changed.example.com');
    await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'folia_sync_config_v1') throw new DOMException('Storage full', 'QuotaExceededError');
            return set.call(this, key, value);
        };
    });
    await root.getByRole('button', { name: 'Sync Fanjiao data' }).click();
    await expect(section.getByRole('status')).toContainText('Free some storage');
});
