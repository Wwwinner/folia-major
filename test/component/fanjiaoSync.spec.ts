import { test, expect } from './fixtures';

// Verify opt-in controls, actionable errors and deletion using the production settings and history components.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('folia_sync_config_v1', JSON.stringify({ provider: 'sync-server', enabled: true, workerBaseUrl: 'https://sync.example.com', authToken: 'fixture-token' }));
        localStorage.setItem('folia_episode_progress_v1', JSON.stringify({ 'online:fanjiao:1': {
            position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90,
            metadata: { name: 'Episode one', albumId: '7', albumName: 'Drama', author: 'Studio', coverUrl: '', kind: 'main' },
        } }));
    });
});

test('defaults off, transfers only the chosen category and preserves data when disabled', async ({ page, mount }) => {
    const calls: string[] = [];
    await page.route('https://sync.example.com/**', async route => {
        const request = route.request(); calls.push(`${request.method()} ${new URL(request.url()).pathname}`);
        const body = request.url().endsWith('/health') ? { ok: true, capabilities: { fanjiaoSync: 1 } }
            : request.method() === 'POST' ? { ok: true, protocol: 1 }
                : { protocol: 1, history: { epoch: { counter: 0, device: '' }, records: [] }, cursor: null };
        await route.fulfill({ json: body });
    });
    const root = await mount('fanjiaoSync');
    const section = root.getByTestId('fanjiao-sync-settings');
    await expect(section.getByRole('checkbox')).toHaveCount(2);
    for (const checkbox of await section.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
    await expect(section.getByRole('button', { name: 'Sync Fanjiao data' })).toBeDisabled();
    await section.getByRole('checkbox', { name: /Listening history and resume/ }).check();
    await section.getByRole('button', { name: 'Sync Fanjiao data' }).click();
    await expect(section.getByRole('status')).toContainText('Fanjiao sync completed');
    expect(calls).toEqual(['GET /health', 'POST /fanjiao/history', 'GET /fanjiao/history']);
    await section.getByRole('checkbox', { name: /Listening history and resume/ }).uncheck();
    await root.getByRole('button', { name: 'Save choices' }).click();
    await expect(section.getByRole('button', { name: 'Sync Fanjiao data' })).toBeDisabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folia_episode_progress_v1')!)['online:fanjiao:1'].position)).toBe(627);
});

test('shows an upgrade hint for an old server and fits a narrow window', async ({ page, mount }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('https://sync.example.com/**', route => route.fulfill({ json: { ok: true, schemaVersion: 1 } }));
    const root = await mount('fanjiaoSync');
    await root.getByRole('checkbox', { name: /Playback preference/ }).check();
    await root.getByRole('button', { name: 'Sync Fanjiao data' }).click();
    await expect(root.getByRole('alert')).toContainText('Update your sync server');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/fanjiao-sync-mobile.png' });
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

test('shows a storage error before uploading when choices cannot be saved', async ({ page, mount }) => {
    const root = await mount('fanjiaoSync');
    await root.getByRole('checkbox', { name: /Listening history and resume/ }).check();
    await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'folia_sync_config_v1') throw new DOMException('Storage full', 'QuotaExceededError');
            return set.call(this, key, value);
        };
    });
    await root.getByRole('button', { name: 'Sync Fanjiao data' }).click();
    await expect(root.getByRole('alert')).toContainText('Free some storage');
});
