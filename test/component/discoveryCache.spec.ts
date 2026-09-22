import { expect, test } from './fixtures';

// 使用真实 IndexedDB 和正式首页数据 hook，网络在测试点击前保持挂起。
test('先显示持久缓存，再后台更新并保存新首页', async ({ mount, page }) => {
    await mount('discoveryCache');
    await expect(page.getByText('fanjiao 缓存首页', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cache-loading')).toHaveText('true');
    await page.getByRole('button', { name: '完成饭角请求' }).click();
    await expect(page.getByText('fanjiao 网络新首页 0', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cache-loading')).toHaveText('false');
    await page.reload();
    await mount('discoveryCache');
    await expect(page.getByText('fanjiao 网络新首页 0', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cache-loading')).toHaveText('true');
});
test('刷新失败仍显示缓存，分页从首屏的 nextOffset 继续', async ({ mount, page }) => {
    await mount('discoveryCache');
    await expect(page.getByText('fanjiao 缓存首页', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '饭角请求失败' }).click();
    await expect(page.getByTestId('cache-error')).toHaveText('false');
    await expect(page.getByTestId('cache-loading')).toHaveText('false');
    await page.getByRole('button', { name: '加载下一页' }).click();
    await page.getByRole('button', { name: '完成饭角请求' }).click();
    await expect(page.getByText('fanjiao 缓存首页', { exact: true })).toBeVisible();
    await expect(page.getByText('fanjiao 网络新首页 20', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cache-offset')).toHaveText('40');
});
test('来源切换隔离缓存并忽略旧来源的迟到响应', async ({ mount, page }) => {
    await mount('discoveryCache');
    await expect(page.getByText('fanjiao 缓存首页', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '切换来源' }).click();
    await expect(page.getByText('other 缓存首页', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '完成饭角请求' }).click();
    await expect(page.getByText('fanjiao 网络新首页 0', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '完成另一来源请求' }).click();
    await expect(page.getByText('other 网络新首页 0', { exact: true })).toBeVisible();
});
test('先到达的新数据不会被 IndexedDB 中的旧首页覆盖', async ({ mount, page }) => {
    await mount('discoveryCache', { fastNetwork: true });
    await expect(page.getByText('网络新首页', { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    await expect(page.getByText('fanjiao 缓存首页', { exact: true })).toHaveCount(0);
});
