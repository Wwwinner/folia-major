import { expect, test } from './fixtures';
import fs from 'node:fs';

// 验证真实设置组件的可访问交互与错误反馈，不修改用户的代理或配置。
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        let value = { mode: 'custom', address: 'http://127.0.0.1:7897' };
        (window as any).__proxySaves = [];
        (window as any).electron = {
            getSettings: async () => ({ NETWORK_PROXY_SUPPORTED: true, NETWORK_PROXY: value, NETWORK_PROXY_RESTART_REQUIRED: false }),
            saveSettings: async (key: string, settings: typeof value) => {
                if (settings.mode === 'custom' && settings.address === 'bad') throw new Error('INVALID_PROXY_SETTINGS');
                if ((window as any).__failProxySave) throw new Error('Disk unavailable');
                (window as any).__proxySaves.push({ key, settings });
                value = { ...settings, address: settings.mode === 'custom' ? settings.address : '' };
                return { NETWORK_PROXY: value, NETWORK_PROXY_RESTART_REQUIRED: true };
            },
        };
    });
});
test('loads the existing address, validates input and saves with restart feedback', async ({ mount, page }) => {
    await mount('proxySettings');
    const address = page.getByLabel('Proxy address', { exact: true });
    await expect(address).toHaveValue('http://127.0.0.1:7897');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await address.fill('bad');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('valid proxy address');
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await address.fill('http://127.0.0.1:7898');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Restart');
    await expect.poll(() => page.evaluate(() => (window as any).__proxySaves.length)).toBe(1);
    await page.getByRole('button', { name: 'Connection mode', exact: true }).click();
    await page.getByRole('option', { name: 'No proxy', exact: true }).click();
    await expect(address).toHaveCount(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__proxySaves.at(-1).settings.mode)).toBe('direct');
});
test('keeps unsaved changes after a save error', async ({ mount, page }) => {
    await mount('proxySettings');
    await page.getByLabel('Proxy address', { exact: true }).fill('http://localhost:8888');
    await page.evaluate(() => { (window as any).__failProxySave = true; });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not save');
    await expect(page.getByLabel('Proxy address', { exact: true })).toHaveValue('http://localhost:8888');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});
for (const width of [1100, 680]) test(`layout at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 720 });
    await mount('proxySettings');
    await expect(page.getByLabel('Proxy address', { exact: true })).toHaveValue('http://127.0.0.1:7897');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    fs.mkdirSync('test-results/proxy-settings', { recursive: true });
    await page.screenshot({ path: `test-results/proxy-settings/${width}.png` });
});
