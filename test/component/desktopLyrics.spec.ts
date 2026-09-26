import { expect, test } from './fixtures';

// 真实 DOM 验证：纯字幕模式不会带入主播放器内容，锁定后没有窗口控件。
for (const width of [720, 390]) {
    test(`纯字幕悬浮窗与重叠句（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 340 });
        await page.addInitScript(() => localStorage.setItem('i18nextLng', 'zh-CN'));
        await mount('desktopLyrics');
        const root = page.getByTestId('desktop-lyrics-window');
        await expect(root.getByTestId('desktop-subtitle')).toHaveCount(2);
        for (const line of await root.getByTestId('desktop-subtitle').all()) await expect(line).toBeInViewport();
        await expect(root).not.toContainText('未来字幕');
        await expect(root.locator('audio, img, canvas')).toHaveCount(0);
        expect(await root.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        await root.hover();
        await root.getByRole('button', { name: '字幕设置', exact: true }).click();
        const glow = root.getByRole('slider', { name: '发光强度', exact: true });
        await glow.press('Home');
        await expect(glow).toHaveValue('0');
        await glow.fill('1');
        await root.getByRole('button', { name: '字幕设置', exact: true }).click();
        await root.getByRole('button', { name: '锁定字幕', exact: true }).click();
        await expect(root.getByRole('button')).toHaveCount(0);
        expect(await root.getByTestId('desktop-lyrics-text').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('desktop-subtitles.png') });
        await page.getByTestId('caption-test-controls').getByRole('button', { name: '句子结束', exact: true }).click();
        await expect(root.getByTestId('desktop-subtitle')).toHaveCount(1);
        await page.getByTestId('caption-test-controls').getByRole('button', { name: '回退', exact: true }).click();
        await expect(root).not.toContainText('许：');
        await page.getByTestId('caption-test-controls').getByRole('button', { name: '换集', exact: true }).click();
        await expect(root.getByTestId('desktop-subtitle')).toHaveText('这是另一集的字幕。');
        await expect(root).not.toContainText('林：');
    });
}
