import { expect, test } from './fixtures';

// 检查雾气占位不泄露台词，散雾与暂停/回退同步，并批量截取宽窄窗口的三个阶段。
for (const width of [1920, 390]) {
    test(`占位到散雾的连续阶段（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(() => localStorage.setItem('i18nextLng', 'zh-CN'));
        await mount('dialogueMist');
        const rail = page.getByTestId('dialogue-scroll');
        await expect(rail.locator('[data-dialogue-mist="pending"]')).toHaveCount(2);
        await expect(rail.locator('[data-dialogue-line]')).toHaveCount(0);
        await expect(page.getByText('夏可：雨还没停，我们再等一会儿吧。', { exact: true })).toHaveCount(0);
        await expect(rail.locator('[data-dialogue-mist="pending"]').nth(1)).toHaveCSS('opacity', '0');
        await page.waitForTimeout(1800);
        const alignment = await rail.locator('[data-dialogue-mist="pending"]').first().evaluate(node => {
            const mist = node.getBoundingClientRect();
            const slot = node.closest('[data-dialogue-reveal]')!.getBoundingClientRect();
            return { centerOffset: Math.abs(mist.y + mist.height / 2 - slot.y - slot.height / 2),
                height: mist.height, textHeight: slot.height };
        });
        expect(alignment.centerOffset).toBeLessThan(0.5);
        expect(alignment.height).toBeGreaterThan(alignment.textHeight);
        expect(alignment.height).toBeLessThan(alignment.textHeight * 1.4);
        expect(alignment.height - alignment.textHeight).toBeLessThanOrEqual(16);
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
        expect(during).toBeGreaterThan(0.3);
        expect(during).toBeLessThan(0.7);
        await page.waitForTimeout(200);
        expect(await opacity()).toBeCloseTo(during, 3);
        const scatter = await mist.evaluate(node => {
            const canvas = node.querySelector('canvas')!;
            const gl = canvas.getContext('webgl')!;
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const core = node.getBoundingClientRect(), stage = canvas.getBoundingClientRect();
            const clip = node.closest('[data-dialogue-reveal]')!.parentElement!.getBoundingClientRect();
            let visibleTail = 0, edgeAlpha = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                const alpha = pixels[(y * canvas.width + x) * 4 + 3];
                const px = stage.left + (x + 0.5) * stage.width / canvas.width;
                const py = stage.bottom - (y + 0.5) * stage.height / canvas.height;
                if (alpha > 4 && (py < core.top || py > core.bottom || px < core.left || px > core.right)
                    && px >= clip.left && px <= clip.right && py >= clip.top && py <= clip.bottom) visibleTail++;
                if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) edgeAlpha = Math.max(edgeAlpha, alpha);
            }
            return { visibleTail, edgeAlpha };
        });
        expect(scatter.visibleTail).toBeGreaterThan(0);
        expect(scatter.edgeAlpha).toBeLessThan(5);
        await page.screenshot({ path: testInfo.outputPath('02-reveal.png') });
        await page.getByRole('button', { name: '散开后', exact: true }).click();
        await expect.poll(opacity).toBe(0);
        const pending = rail.locator('[data-dialogue-mist="pending"]');
        await expect(pending).toHaveCount(2);
        await expect(pending.first()).toHaveCSS('opacity', '0');
        await expect(pending.nth(1)).toHaveCSS('opacity', '0');
        await page.screenshot({ path: testInfo.outputPath('03-clear.png') });
        await page.getByRole('button', { name: '雾气占位', exact: true }).click();
        await expect(rail.locator('[data-dialogue-line]')).toHaveCount(0);
        await page.getByRole('button', { name: '重叠对白', exact: true }).click();
        await expect(rail.locator('[data-dialogue-active="true"]')).toHaveCount(2);
        await expect(rail.locator('[data-monet-word-sweep]')).toHaveCount(0);
        await page.getByRole('button', { name: '短句前', exact: true }).click();
        await page.waitForTimeout(1200);
        const short = rail.locator('[data-dialogue-slot="3"]');
        const waitingWidth = await short.evaluate(node => ({
            fog: node.querySelector('[data-dialogue-mist]')!.getBoundingClientRect().width,
            column: node.querySelector('[data-dialogue-reveal]')!.getBoundingClientRect().width,
        }));
        expect(waitingWidth.fog).toBeLessThan(waitingWidth.column * 0.85);
        await page.screenshot({ path: testInfo.outputPath('04-short-cue-mist.png') });
        await page.getByRole('button', { name: '短句', exact: true }).click();
        await page.waitForTimeout(800);
        const actualWidth = await short.evaluate(node => {
            const text = node.querySelector('[data-monet-sentence-text]')!;
            const range = document.createRange();
            range.selectNodeContents(text);
            const glyphs = range.getBoundingClientRect();
            const mist = node.querySelector('[data-dialogue-mist]')!.getBoundingClientRect();
            return { mist: mist.width, glyphs: glyphs.width,
                centerOffset: Math.abs(mist.x + mist.width / 2 - glyphs.x - glyphs.width / 2),
                fontPx: Number.parseFloat(getComputedStyle(text).fontSize) };
        });
        expect(actualWidth.mist).toBeGreaterThanOrEqual(actualWidth.glyphs);
        expect(actualWidth.mist).toBeLessThan(actualWidth.glyphs + actualWidth.fontPx * 0.9);
        expect(actualWidth.centerOffset).toBeLessThan(actualWidth.fontPx * 0.4);
    });
}
for (const width of [1100, 390]) {
    test(`雾纹内部流动，暂停后停止绘制（${width}px）`, async ({ mount, page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await mount('dialogueMist');
        await page.getByRole('button', { name: '提前两秒', exact: true }).click();
        const textures = page.locator('[data-dialogue-mist="pending"] canvas');
        const texture = textures.first();
        const hiddenFrame = await texture.getAttribute('data-mist-frame');
        await page.getByRole('button', { name: '继续', exact: true }).click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        expect(await texture.getAttribute('data-mist-frame')).toBe(hiddenFrame);
        await expect(page.locator('[data-dialogue-slot="1"] [data-dialogue-mist]')).toHaveCSS('opacity', '0');
        await page.getByRole('button', { name: '起雾中', exact: true }).click();
        await expect(texture).toHaveAttribute('data-mist-renderer', 'webgl');
        await page.waitForTimeout(1200);
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
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        await page.waitForTimeout(120);
        const after = await sample();
        const changed = after.pixels.filter((value, index) => index % 4 === 3 && Math.abs(value - before.pixels[index]) > 4).length;
        expect(changed / alpha.length).toBeGreaterThan(0.05);
        expect(after.frame - before.frame).toBeGreaterThan(3);
        expect(after.frame - before.frame).toBeLessThanOrEqual(24);
        await page.waitForTimeout(250);
        const paused = await sample();
        expect(paused.image).toBe(after.image);
        expect(paused.frame).toBe(after.frame);
        await page.getByRole('button', { name: '提前两秒', exact: true }).click();
        await expect(page.locator('[data-dialogue-slot="1"] [data-dialogue-mist]')).toHaveCSS('opacity', '0');
        const rewoundFrame = await texture.getAttribute('data-mist-frame');
        await page.waitForTimeout(150);
        expect(await texture.getAttribute('data-mist-frame')).toBe(rewoundFrame);
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
