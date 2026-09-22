import { expect, test } from './fixtures';

// 验证双列虚拟化的真实布局与点击身份，避免项目索引误当成行索引。
for (const width of [1100, 390]) {
    test(`分集双列保留顺序、末行和收听进度（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(() => {
            localStorage.setItem('i18nextLng', 'zh-CN');
            localStorage.setItem('folia_episode_progress_v1', JSON.stringify({
                'online:fanjiao:50': { position: 627, duration: 1800, completed: false, updatedAt: Date.now() },
            }));
        });
        await mount('episodeSidePanel');
        const panel = page.getByTestId('side-panel-list');
        const last = panel.locator('[data-episode-id="51"]');
        await expect(last).toBeInViewport({ ratio: 1 });
        await expect(panel).toHaveCSS('transform', 'none');
        const singleHeight = (await last.boundingBox())!.height;
        const singleButtonHeight = (await last.getByRole('button', { name: /第51集/ }).boundingBox())!.height;
        await expect(panel.getByRole('button', { name: '加入播放队列' })).toHaveCount(0);
        await page.getByTestId('episode-columns-toggle').click();
        await expect(panel).toHaveAttribute('data-columns', '2');
        await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(width === 1100 ? 480 : 342, 0);
        await expect(last).toBeInViewport({ ratio: 1 });
        const left = panel.locator('[data-episode-id="49"]');
        const right = panel.locator('[data-episode-id="50"]');
        const boxes = await Promise.all([left.boundingBox(), right.boundingBox(), last.boundingBox()]);
        expect(boxes.every(Boolean)).toBe(true);
        expect(boxes[2]!.height).toBe(singleHeight);
        expect(singleHeight).toBe(76);
        expect((await last.getByRole('button', { name: /第51集/ }).boundingBox())!.height).toBe(singleButtonHeight);
        expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
        expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 1);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
        const progress = right.getByText('已播放 10:27', { exact: true });
        await expect(progress).toBeVisible();
        expect(await progress.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        const countBox = (await right.getByText('2.8w', { exact: true }).boundingBox())!;
        const progressBox = (await progress.boundingBox())!;
        const titleBox = (await right.getByText(/第50集/).boundingBox())!;
        expect(countBox.y - titleBox.y - titleBox.height).toBeCloseTo(4, 0);
        expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(boxes[1]!.y + boxes[1]!.height);
        if (width === 1100) expect(Math.abs(countBox.y - progressBox.y)).toBeLessThan(1);
        else expect(progressBox.y).toBeGreaterThan(countBox.y);
        await panel.screenshot({ path: testInfo.outputPath('two-columns.png') });
        await right.getByRole('button', { name: /第50集/ }).click();
        await expect(page.locator('[data-probe-selected]')).toHaveAttribute('data-probe-selected', '50');
        await page.getByTestId('episode-columns-toggle').click();
        await expect(panel).toHaveAttribute('data-columns', '1');
        await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(320, 0);
        await expect(right).toBeInViewport({ ratio: 1 });
        await panel.screenshot({ path: testInfo.outputPath('single-column.png') });
    });
}

for (const reducedMotion of [false, true]) {
    test(`面板宽度过渡保留阅读位置（减少动态效果：${reducedMotion}）`, async ({ mount, page }) => {
        await page.setViewportSize({ width: 1100, height: 900 });
        // 项目默认不跟随系统；面板应遵守用户对 UI 微动效的显式选择。
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript(enabled => localStorage.setItem('reduce_motion_uiMicroMotion', String(enabled)), reducedMotion);
        await mount('episodeSidePanel');
        const panel = page.getByTestId('side-panel-list');
        await expect(panel.locator('[data-episode-id="51"]')).toBeInViewport({ ratio: 1 });
        await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(320, 1);
        const scroller = panel.locator('.custom-scrollbar');
        await scroller.evaluate(el => { el.scrollTop = el.scrollHeight * 0.4; });
        await expect(panel.locator('[data-episode-id="51"]')).not.toBeInViewport();
        const anchorId = await scroller.evaluate(el => {
            const bounds = el.getBoundingClientRect();
            return [...el.querySelectorAll<HTMLElement>('[data-episode-id]')]
                .find(row => row.getBoundingClientRect().top >= bounds.top)?.dataset.episodeId;
        });
        expect(anchorId).toBeTruthy();
        const samples = await panel.evaluate(async el => {
            const frames: { width: number; right: number }[] = [];
            (el.querySelector('[data-testid="episode-columns-toggle"]') as HTMLButtonElement).click();
            const start = performance.now();
            while (performance.now() - start < 450) {
                const box = el.getBoundingClientRect();
                frames.push({ width: box.width, right: box.right });
                await new Promise(requestAnimationFrame);
            }
            return frames;
        });
        expect(samples.some(frame => frame.width > 322 && frame.width < 478)).toBe(!reducedMotion);
        expect(samples.at(-1)!.width).toBeCloseTo(480, 0);
        expect(Math.max(...samples.map(frame => frame.right)) - Math.min(...samples.map(frame => frame.right))).toBeLessThan(1);
        await expect(panel.locator(`[data-episode-id="${anchorId}"]`)).toBeInViewport();
        // 动画未结束时反复切换，应从当前位置继续，最终宽度与模式一致。
        await panel.evaluate(async el => {
            const button = el.querySelector('[data-testid="episode-columns-toggle"]') as HTMLButtonElement;
            for (let i = 0; i < 3; i++) {
                button.click();
                await new Promise(resolve => setTimeout(resolve, 40));
            }
        });
        await expect(panel).toHaveAttribute('data-columns', '1');
        await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(320, 0);
        await expect(panel.locator(`[data-episode-id="${anchorId}"]`)).toBeInViewport();
    });
}
