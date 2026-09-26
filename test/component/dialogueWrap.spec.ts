import { expect, test } from './fixtures';

// 真实浏览器核对句级断行与测量高度，覆盖括号、角色名、长段落和光效的独立播放时钟。
for (const width of [1100, 700, 390]) {
    test(`长对白完整换行，测量与 DOM 一致（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await mount('dialogue');
        await page.getByRole('button', { name: 'Wrap sample', exact: true }).click();
        const active = page.locator('[data-dialogue-line="2"]');
        await expect(active).toHaveAttribute('data-dialogue-active', 'true');
        await page.waitForTimeout(2000);
        const geometry = await active.evaluate(node => {
            const text = node.querySelector('[data-monet-sentence-text]')!;
            const range = document.createRange(); range.selectNodeContents(text);
            const fragments = [...range.getClientRects()].filter(rect => rect.width > 0);
            const bounds = text.getBoundingClientRect();
            const style = getComputedStyle(text);
            return { rows: new Set(fragments.map(rect => Math.round(rect.top))).size,
                measured: Number(node.getAttribute('data-text-rows')), width: bounds.width,
                overflow: fragments.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1),
                nodeHeight: node.getBoundingClientRect().height, textHeight: bounds.height,
                glow: style.textShadow, content: text.textContent, font: style.font, lineHeight: style.lineHeight,
                parentWidth: text.parentElement!.getBoundingClientRect().width, fragments: fragments.map(rect => ({ width: rect.width, top: rect.top })) };
        });
        expect(geometry.rows).toBeGreaterThan(1);
        expect(geometry.measured, JSON.stringify(geometry)).toBe(geometry.rows);
        expect(geometry.overflow).toBe(false);
        expect(geometry.nodeHeight).toBeGreaterThanOrEqual(geometry.textHeight);
        expect(geometry.glow).not.toBe('none');
        expect(geometry.content).toBe('孔今瑶：【微信】好~那就约在周六晚上，我们一起吃饭吧。');
        await expect(page.locator('[data-monet-word-sweep]')).toHaveCount(0);
        const boxes = await page.locator('[data-dialogue-line]').evaluateAll(nodes => nodes.map(node => {
            const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom };
        }));
        for (let index = 1; index < boxes.length; index++) expect(boxes[index].top - boxes[index - 1].bottom).toBeGreaterThanOrEqual(-1);
        await page.screenshot({ path: testInfo.outputPath('wrapped-dialogue.png') });
    });
}
test('光晕暂停时保持，倒带时同步回退，不产生逐字蒙版', async ({ mount, page }) => {
    await mount('dialogue');
    const time = page.getByTestId('dialogue-time');
    await time.fill('12.16');
    const text = page.locator('[data-dialogue-line="2"] [data-monet-sentence-text]');
    const shadow = () => text.evaluate(node => getComputedStyle(node).textShadow);
    await expect.poll(shadow).not.toBe('none');
    const halfway = await shadow();
    await page.waitForTimeout(300);
    expect(await shadow()).toBe(halfway);
    await time.fill('13');
    await expect.poll(shadow).not.toBe(halfway);
    await time.fill('12.16');
    await expect.poll(shadow).toBe(halfway);
    await time.fill('19');
    await expect.poll(shadow).toBe('none');
    await expect(page.locator('[data-monet-word-sweep]')).toHaveCount(0);
});

test('参数滑块实时调整光晕，保存后重新打开仍生效，并可恢复默认', async ({ mount, page, context }, testInfo) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await mount('dialogue');
    await page.getByRole('button', { name: 'Parameters', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Glow Intensity', exact: true });
    const text = page.locator('[data-dialogue-line="2"] [data-monet-sentence-text]');
    const shadow = () => text.evaluate(node => getComputedStyle(node).textShadow);
    await expect(slider).toHaveValue('1');
    await expect.poll(shadow).not.toBe('none');
    const baseline = await shadow();
    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', '200%');
    await expect.poll(shadow).not.toBe(baseline);
    await slider.press('Home');
    await expect.poll(shadow).toBe('none');
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('0.05');
    await expect.poll(shadow).not.toBe('none');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('monet_tuning')!).glowIntensity)).toBe(0.05);

    // 新页面复用真实 localStorage，避开本测试页每次导航时的清空夹具。
    const reopened = await context.newPage();
    await reopened.goto(new URL('/dev-probe.html?probe=dialogue', page.url()).href);
    await reopened.getByRole('button', { name: 'Parameters', exact: true }).click();
    const restored = reopened.getByRole('slider', { name: 'Glow Intensity', exact: true });
    await expect(restored).toHaveValue('0.05');
    await reopened.getByRole('button', { name: 'Reset parameters', exact: true }).click();
    await expect(restored).toHaveValue('1');
    await reopened.screenshot({ path: testInfo.outputPath('glow-parameters.png') });
    await reopened.close();
    await expect(page.locator('[data-monet-word-sweep]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Monet reference', exact: true }).click();
    const wordGlow = () => page.locator('[data-monet-word-sweep] > span:first-child')
        .evaluateAll(nodes => nodes.some(node => getComputedStyle(node).textShadow !== 'none'));
    await expect.poll(wordGlow).toBe(true);
    await slider.press('Home');
    await expect.poll(wordGlow).toBe(false);
    await slider.press('End');
    await expect.poll(wordGlow).toBe(true);
});
