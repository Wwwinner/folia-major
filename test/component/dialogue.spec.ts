import { expect, test } from './fixtures';

// 对白与莫奈共享构图和轨道；这里只验证句级分支与原莫奈保持的交互合同。
for (const width of [1100, 390]) {
    test(`对白整句显示且只保留当前及过去台词（${width}px）`, async ({ mount, page }, testInfo) => {
        const renderErrors: string[] = [];
        page.on('console', message => { if (message.type() === 'error') renderErrors.push(message.text()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(() => localStorage.setItem('i18nextLng', 'zh-CN'));
        await mount('dialogue');
        const mode = page.getByTestId('visualizer-dialogue');
        const rail = page.getByTestId('dialogue-scroll');
        await expect(mode.locator('[data-dialogue-active="true"]')).toHaveCount(2);
        await expect(mode.locator('[data-dialogue-line="3"]')).toHaveCount(0);
        await expect(mode.locator('[data-monet-word-sweep]')).toHaveCount(0);
        await expect(mode.locator('[data-dialogue-line] svg')).toHaveCount(0);
        await expect(mode.locator('[data-dialogue-line="2"]')).toContainText('你站在我身旁，什么也没说。');
        expect(await mode.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
        await page.waitForTimeout(2000);
        await page.screenshot({ path: testInfo.outputPath('dialogue.png') });
        await rail.hover(); await page.mouse.wheel(0, -100);
        await mode.locator('[data-dialogue-line="1"]').click();
        await expect(page.getByTestId('dialogue-seek-result')).toHaveText('8');
        await expect(mode.locator('[data-dialogue-line="2"]')).toHaveCount(0);
        await mode.locator('[data-dialogue-line="0"]').focus();
        await page.keyboard.press('Space');
        await expect(page.getByTestId('dialogue-seek-result')).toHaveText('2');
        await expect(mode.locator('[data-dialogue-line]')).toHaveCount(1);
        await page.getByTestId('dialogue-time').fill('0');
        await expect(mode.locator('[data-dialogue-line]')).toHaveCount(0);
        await expect(mode).toContainText('等待对白开始');
        await page.getByTestId('dialogue-time').fill('20');
        await expect(mode.locator('[data-dialogue-line]')).toHaveCount(3);
        await expect(mode.locator('[data-dialogue-active="true"]')).toHaveCount(0);
        await page.getByRole('button', { name: 'New episode', exact: true }).click();
        await expect(mode).toContainText('暂无字幕');
        expect(renderErrors).toEqual([]);
    });
}
test('长字幕使用莫奈小窗口，滚轮回看后自动跟随且不预览未来', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await mount('dialogue');
    await page.waitForTimeout(2000);
    const probe = page.getByTestId('dialogue-probe');
    const before = Number(await probe.getAttribute('data-renders'));
    await page.getByTestId('dialogue-tick').click();
    await expect(probe).toHaveAttribute('data-ticked', 'true');
    expect(Number(await probe.getAttribute('data-renders')) - before).toBeLessThanOrEqual(1);
    await page.getByTestId('dialogue-time').fill('2516');
    await expect(page.locator('[data-dialogue-line="500"]')).toBeInViewport();
    expect(await page.locator('[data-dialogue-line]').count()).toBeLessThanOrEqual(9);
    const rail = page.getByTestId('dialogue-scroll');
    await rail.hover(); await page.mouse.wheel(0, -150);
    await expect(page.locator('[data-dialogue-line="495"]')).toBeAttached();
    expect(await page.locator('[data-dialogue-line]').evaluateAll(nodes => nodes.every(node => Number(node.getAttribute('data-start-time')) <= 2516))).toBe(true);
    await expect(page.locator('[data-dialogue-line="495"]')).toHaveCount(0, { timeout: 3500 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('[data-dialogue-line="500"]')).toHaveAttribute('aria-disabled', 'true');
});
test('对白直接继承莫奈封面构图及字体参数，普通莫奈仍有逐字特效', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await mount('dialogue');
    const current = page.locator('[data-dialogue-line="2"]');
    await expect(current).toBeAttached();
    await page.waitForTimeout(2000);
    const cover = page.locator('[data-monet-portrait-image]').last();
    const dialogueBox = (await cover.boundingBox())!;
    const font = () => current.locator(':scope > div').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const baseFont = await font();
    await page.getByRole('button', { name: 'Font scale', exact: true }).click();
    await expect.poll(font).toBeCloseTo(baseFont * 1.5, 1);
    await page.getByRole('button', { name: 'Font scale', exact: true }).click();
    await page.getByRole('button', { name: 'Monet reference', exact: true }).click();
    await page.getByTestId('monet-scroll').waitFor();
    await page.waitForTimeout(2000);
    await expect(page.locator('[data-monet-word-sweep]').first()).toBeAttached();
    const monetBox = (await cover.boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(dialogueBox[key]).toBeCloseTo(monetBox[key], 0);
});
for (const reducedMotion of [false, true]) {
    test(`对白沿用莫奈行过渡并响应动态效果设置（${reducedMotion}）`, async ({ mount, page }) => {
        await page.setViewportSize({ width: 1100, height: 900 });
        await page.addInitScript(value => localStorage.setItem('reduce_motion_uiMicroMotion', String(value)), reducedMotion);
        await mount('dialogue');
        const input = page.getByTestId('dialogue-time');
        await input.fill('2516');
        const previous = page.locator('[data-dialogue-line="500"]');
        await expect(previous).toBeInViewport();
        await page.waitForTimeout(2000);
        const initial = (await previous.boundingBox())!.y;
        await input.fill('2521');
        const samples = await previous.evaluate(async el => {
            const values: number[] = [];
            const start = performance.now();
            while (performance.now() - start < 650) { values.push(el.getBoundingClientRect().y); await new Promise(requestAnimationFrame); }
            return values;
        });
        expect(samples.at(-1)!).toBeLessThan(initial - 5);
        if (!reducedMotion) expect(new Set(samples.map(Math.round)).size).toBeGreaterThan(3);
        else expect(new Set(samples.map(Math.round)).size).toBeLessThanOrEqual(2);
        await input.fill('13');
        await expect(page.locator('[data-dialogue-line="3"]')).toHaveCount(0);
        await expect(page.locator('[data-dialogue-line="2"]')).toBeAttached();
    });
}
