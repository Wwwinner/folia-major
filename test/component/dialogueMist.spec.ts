import { expect, test } from './fixtures';

// 检查雾气占位不泄露台词，散雾与暂停/回退同步，并批量截取宽窄窗口的三个阶段。
for (const width of [1100, 390]) {
    test(`占位到散雾的连续阶段（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(() => localStorage.setItem('i18nextLng', 'zh-CN'));
        await mount('dialogueMist');
        const rail = page.getByTestId('dialogue-scroll');
        await expect(rail.locator('[data-dialogue-mist="pending"]')).toHaveCount(2);
        await expect(rail.locator('[data-dialogue-line]')).toHaveCount(0);
        await expect(page.getByText('夏可：雨还没停，我们再等一会儿吧。', { exact: true })).toHaveCount(0);
        await page.waitForTimeout(1800);
        await page.screenshot({ path: testInfo.outputPath('01-waiting.png') });
        await page.getByRole('button', { name: '散雾中', exact: true }).click();
        const text = rail.locator('[data-dialogue-line="0"]');
        const mist = text.locator('[data-dialogue-mist="reveal"]');
        await expect(text).toContainText('夏可：雨还没停，我们再等一会儿吧。');
        await expect(rail.locator('[data-dialogue-line="1"]')).toHaveCount(0);
        const opacity = () => mist.evaluate(node => Number(getComputedStyle(node).opacity));
        await page.waitForTimeout(600);
        const during = await opacity();
        expect(during).toBeGreaterThan(0);
        expect(during).toBeGreaterThan(0.7);
        expect(during).toBeLessThanOrEqual(0.8);
        await page.waitForTimeout(200);
        expect(await opacity()).toBeCloseTo(during, 3);
        await page.screenshot({ path: testInfo.outputPath('02-reveal.png') });
        await page.getByRole('button', { name: '散开后', exact: true }).click();
        await expect.poll(opacity).toBe(0);
        const pending = rail.locator('[data-dialogue-mist="pending"]');
        await expect(pending).toHaveCount(2);
        await expect(pending.first()).toBeVisible();
        await expect(pending.first()).toHaveCSS('visibility', 'visible');
        await page.screenshot({ path: testInfo.outputPath('03-clear.png') });
        await page.getByRole('button', { name: '雾气占位', exact: true }).click();
        await expect(rail.locator('[data-dialogue-line]')).toHaveCount(0);
        await page.getByRole('button', { name: '重叠对白', exact: true }).click();
        await expect(rail.locator('[data-dialogue-active="true"]')).toHaveCount(2);
        await expect(rail.locator('[data-monet-word-sweep]')).toHaveCount(0);
    });
}
for (const width of [1100, 390]) {
    test(`雾纹内部流动，暂停后停止绘制（${width}px）`, async ({ mount, page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await mount('dialogueMist');
        await page.getByRole('button', { name: '散开后', exact: true }).click();
        const textures = page.locator('[data-dialogue-mist="pending"] canvas');
        const texture = textures.first();
        await expect(texture).toHaveAttribute('data-mist-renderer', 'webgl');
        await page.waitForTimeout(1200);
        const phaseDifference = await textures.evaluateAll(nodes => {
            const alpha = nodes.map(node => {
                const copy = document.createElement('canvas');
                copy.width = 64; copy.height = 32;
                const context = copy.getContext('2d')!;
                context.drawImage(node as HTMLCanvasElement, 0, 0, 64, 32);
                return Array.from(context.getImageData(0, 0, 64, 32).data).filter((_, index) => index % 4 === 3);
            });
            return alpha[0].reduce((sum, value, index) => sum + Math.abs(value - alpha[1][index]), 0) / alpha[0].length;
        });
        expect(phaseDifference).toBeGreaterThan(6);
        const sample = () => texture.evaluate((canvas: HTMLCanvasElement) => {
            const gl = canvas.getContext('webgl')!;
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return { pixels: Array.from(pixels), frame: Number(canvas.dataset.mistFrame),
                width: canvas.width, height: canvas.height, image: canvas.toDataURL() };
        });
        const before = await sample();
        expect(before.width).toBeLessThanOrEqual(384);
        expect(before.height).toBeLessThanOrEqual(128);
        const alpha = before.pixels.filter((_, index) => index % 4 === 3);
        expect(alpha.filter(value => value > 20).length / alpha.length).toBeGreaterThan(0.05);
        expect(alpha.filter(value => value < 5).length / alpha.length).toBeGreaterThan(0.05);
        await page.getByRole('button', { name: '继续', exact: true }).click();
        await page.waitForTimeout(900);
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        await page.waitForTimeout(120);
        const after = await sample();
        const changed = after.pixels.filter((value, index) => index % 4 === 3 && Math.abs(value - before.pixels[index]) > 4).length;
        expect(changed / alpha.length).toBeGreaterThan(0.05);
        expect(after.frame - before.frame).toBeGreaterThan(3);
        expect(after.frame - before.frame).toBeLessThanOrEqual(32);
        await page.waitForTimeout(250);
        const paused = await sample();
        expect(paused.image).toBe(after.image);
        expect(paused.frame).toBe(after.frame);
        expect(errors).toEqual([]);
    });
}
test('减少动态效果时保留完整字幕，关闭雾层', async ({ mount, page }) => {
    await page.addInitScript(() => localStorage.setItem('reduce_motion_uiMicroMotion', 'true'));
    await mount('dialogueMist');
    await expect(page.locator('[data-dialogue-mist]')).toHaveCount(0);
    await page.getByRole('button', { name: '散雾中', exact: true }).click();
    await expect(page.locator('[data-dialogue-reveal] > div').first()).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-dialogue-mist]')).toHaveCount(0);
});
