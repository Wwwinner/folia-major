import { expect, test } from './fixtures';

// 记录真实连续播放帧，核验等待行没有在边界被替换，并对比莫奈与对白的滚动/缩放曲线。
for (const width of [1100, 390]) {
    test(`对白沿用莫奈的连续行过渡（${width}px）`, async ({ mount, page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        const runs: Record<string, any> = {};
        for (const mode of ['dialogue', 'monet']) {
            if (mode === 'monet') await page.reload();
            await mount('dialogueMist');
            if (mode === 'monet') await page.getByRole('button', { name: '莫奈对照', exact: true }).click();
            await page.getByRole('button', { name: '下一句前', exact: true }).click();
            const row = page.locator('[data-monet-line="1"]');
            await expect(row).toBeAttached();
            await page.waitForTimeout(1800);
            const result = await page.evaluate(async () => {
                const node = document.querySelector('[data-monet-line="1"]') as HTMLElement;
                const mist = node.querySelector('[data-dialogue-mist]');
                const next = document.querySelector('[data-monet-line="2"]') as HTMLElement;
                const nextMist = next.querySelector('[data-dialogue-mist]');
                const sample = () => {
                    const style = getComputedStyle(node);
                    const text = node.querySelector('[data-dialogue-reveal] > div');
                    const fog = node.querySelector('[data-dialogue-mist]');
                    const slot = node.querySelector('[data-dialogue-reveal]');
                    return { time: Number.parseFloat(document.querySelector('output')!.textContent!),
                        top: node.getBoundingClientRect().top, scale: new DOMMatrixReadOnly(style.transform).a,
                        opacity: Number(style.opacity), hasText: Boolean(node.querySelector('[data-monet-sentence-text]')),
                        innerTransform: text ? getComputedStyle(text).transform : null,
                        textOpacity: text ? Number(getComputedStyle(text).opacity) : null,
                        nextTop: next.getBoundingClientRect().top,
                        waitingGap: next.getBoundingClientRect().top - node.getBoundingClientRect().bottom,
                        mistOffset: fog && slot ? fog.getBoundingClientRect().top + fog.getBoundingClientRect().height / 2
                            - slot.getBoundingClientRect().top - slot.getBoundingClientRect().height / 2 : null,
                        mistOpacity: fog ? Number(getComputedStyle(fog).opacity) : null };
                };
                const before = sample();
                [...document.querySelectorAll('button')].find(button => button.textContent === '播放下一句')!.click();
                const frames: ReturnType<typeof sample>[] = [];
                const started = performance.now();
                while (performance.now() - started < 1500) { await new Promise(requestAnimationFrame); frames.push(sample()); }
                return { before, frames, sameRow: node === document.querySelector('[data-monet-line="1"]'),
                    sameMist: mist === node.querySelector('[data-dialogue-mist]'),
                    sameNextRow: next === document.querySelector('[data-monet-line="2"]'),
                    sameNextMist: nextMist === next.querySelector('[data-dialogue-mist]'),
                    nextHasText: Boolean(next.querySelector('[data-monet-sentence-text]')) };
            });
            runs[mode] = result;
            expect(result.sameRow).toBe(true);
            expect(result.before.scale).toBeLessThan(0.99);
            expect(result.frames.at(-1)!.scale).toBeCloseTo(1, 2);
            expect(result.before.top - result.frames.at(-1)!.top).toBeGreaterThan(20);
            const entryFrames = result.frames.filter(frame => frame.time >= 7 && frame.time <= 7.15);
            expect(entryFrames.length).toBeGreaterThan(2);
            expect(entryFrames.every(frame => frame.opacity > 0.35)).toBe(true);
            if (mode === 'dialogue') {
                expect(result.sameMist).toBe(true);
                expect(result.sameNextRow && result.sameNextMist).toBe(true);
                expect(result.nextHasText).toBe(false);
                expect(result.before.nextTop).toBeGreaterThan(result.before.top + 20);
                expect(result.before.waitingGap).toBeGreaterThanOrEqual(0);
                expect(result.before.waitingGap).toBeLessThan(40);
                expect(result.frames.every(frame => Math.abs(frame.mistOffset ?? Infinity) < 0.5)).toBe(true);
                expect(result.before.nextTop - result.frames.at(-1)!.nextTop).toBeGreaterThan(20);
                expect(result.before.hasText).toBe(false);
                expect(result.frames.filter(frame => frame.time < 6.99).every(frame => !frame.hasText)).toBe(true);
                expect(result.frames.every(frame => frame.innerTransform === 'none')).toBe(true);
                expect(result.frames.at(-1)!.mistOpacity).toBe(0);
                const rising = result.frames.find(frame => frame.time >= 7.05 && frame.time < 7.1)!;
                expect(rising).toBeTruthy();
                expect(rising.textOpacity).toBeGreaterThan(0);
                expect(rising.mistOpacity).toBeGreaterThan(0.7);
            }
            await page.getByRole('button', { name: '暂停', exact: true }).click();
            await page.screenshot({ path: testInfo.outputPath(`${mode}-after-transition.png`) });
            if (mode === 'dialogue') {
                const sameMist = await row.locator('[data-dialogue-mist]').elementHandle();
                await page.getByRole('button', { name: '下一句前', exact: true }).click();
                await expect(row.locator('[data-monet-sentence-text]')).toHaveCount(0);
                await expect(row.locator('[data-dialogue-mist="pending"]')).toHaveCount(1);
                expect(await row.evaluate((node, previous) => node.querySelector('[data-dialogue-mist]') === previous, sameMist)).toBe(true);
                await expect(page.locator('[data-dialogue-mist="pending"]')).toHaveCount(2);
            }
        }
        // 归一化位移排除句级换行高度差，比较同一时刻的弹簧进度。
        const progress = (run: any, time: number) => {
            const frame = run.frames.find((item: any) => item.time >= time);
            return (run.before.top - frame.top) / (run.before.top - run.frames.at(-1).top);
        };
        for (const time of [7.1, 7.25, 7.5]) expect(Math.abs(progress(runs.dialogue, time) - progress(runs.monet, time))).toBeLessThan(0.2);
        await testInfo.attach('motion-comparison.json', { body: JSON.stringify(runs, null, 2), contentType: 'application/json' });
    });
}
