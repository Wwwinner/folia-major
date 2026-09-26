import { expect, test } from './fixtures';

// 正式渲染器回归：活动长句跨越多个短句后仍在可读区域，结束、回退与手动回看独立工作。
for (const width of [1100, 390]) {
    test(`长句跨过短句仍保留且可见（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await mount('dialogueOverlap');
        const rail = page.getByTestId('dialogue-scroll');
        const long = rail.locator('[data-dialogue-line="0"]');
        const second = rail.locator('[data-dialogue-line="5"]');
        await expect(long).toHaveAttribute('data-dialogue-active', 'true');
        await expect(second).toHaveAttribute('data-dialogue-active', 'true');
        await expect(rail.locator('[data-dialogue-active="true"]')).toHaveCount(2);
        await expect(rail.locator('[data-dialogue-line="8"]')).toHaveCount(0);
        // DOM 保留本身不够：核对文字确实落在轨道未被遮罩淡出的范围中。
        await expect.poll(() => rail.evaluate(node => {
            const bounds = node.getBoundingClientRect();
            return [...node.querySelectorAll('[data-dialogue-active="true"] [data-monet-sentence-text]')].every(text => {
                const box = text.getBoundingClientRect();
                return box.top >= bounds.top + bounds.height * 0.1 - 1
                    && box.bottom <= bounds.top + bounds.height * 0.9 + 1;
            });
        })).toBe(true);
        await page.waitForTimeout(800);
        await page.screenshot({ path: testInfo.outputPath('overlap-retained.png') });

        await page.getByRole('button', { name: '第二句结束', exact: true }).click();
        await expect(long).toHaveAttribute('data-dialogue-active', 'true');
        await expect(second).toHaveAttribute('data-dialogue-active', 'false');
        await expect(rail.locator('[data-dialogue-active="true"]')).toHaveCount(1);
        await page.getByRole('button', { name: '长句结束', exact: true }).click();
        await expect(rail.locator('[data-dialogue-active="true"]')).toHaveCount(0);
        await page.getByRole('button', { name: '回退到 4 秒', exact: true }).click();
        await expect(long).toHaveAttribute('data-dialogue-active', 'true');
        await expect(second).toHaveCount(0);
        expect(await rail.locator('[data-start-time]').evaluateAll(nodes => nodes.every(node => Number(node.getAttribute('data-start-time')) <= 4))).toBe(true);
        expect(errors).toEqual([]);
    });
}

test('手动历史回看不被活动组锁住，空闲后恢复全部活动句', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await mount('dialogueOverlap');
    const rail = page.getByTestId('dialogue-scroll');
    await expect(rail.locator('[data-dialogue-line="0"]')).toHaveAttribute('data-dialogue-active', 'true');
    await page.waitForTimeout(2000);
    await rail.hover();
    await page.mouse.wheel(0, -150);
    await expect(rail.locator('[data-dialogue-line="2"]')).toBeAttached();
    await expect(rail.locator('[data-dialogue-line="2"]')).toHaveCount(0, { timeout: 3500 });
    await expect(rail.locator('[data-dialogue-line="0"]')).toHaveAttribute('data-dialogue-active', 'true');
    await expect(rail.locator('[data-dialogue-line="5"]')).toHaveAttribute('data-dialogue-active', 'true');
    await rail.locator('[data-dialogue-line="0"]').click();
    await expect(page.getByTestId('overlap-clock')).toHaveText('0.0 / 26 秒');
    await expect(rail.locator('[data-dialogue-line]')).toHaveCount(1);
});
