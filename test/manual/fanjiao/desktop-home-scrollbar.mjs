import assert from 'node:assert/strict';
import path from 'node:path';

// 使用真实滚动容器验证淡入淡出、固定宽度及浏览器原生滑块拖动。
export async function verifyHomeScrollbar(page, output, scroller) {
    const waitVisibility = value => page.waitForFunction(expected => {
        const el = document.querySelector('[data-testid="discovery-home-scroll"]');
        return Math.abs(Number(getComputedStyle(el).getPropertyValue('--discovery-scrollbar-visibility')) - expected) < 0.01;
    }, value);
    await page.mouse.move(15, 15);
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await waitVisibility(0);
    const width = await scroller.evaluate(el => el.clientWidth);
    const box = await scroller.boundingBox();
    await page.mouse.move(box.x + 15, box.y + 30);
    await page.waitForTimeout(200);
    assert.equal(await scroller.evaluate(el => Number(getComputedStyle(el).getPropertyValue('--discovery-scrollbar-visibility'))), 0);
    await page.mouse.move(box.x + box.width - 20, box.y + 30);
    await waitVisibility(1);
    assert.equal(await scroller.evaluate(el => el.clientWidth), width);
    await page.screenshot({ path: path.join(output, 'home-scrollbar-visible.png') });
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    const fade = await scroller.evaluate(el => new Promise(resolve => {
        const samples = [];
        const start = performance.now();
        const sample = () => {
            samples.push(Number(getComputedStyle(el).getPropertyValue('--discovery-scrollbar-visibility')));
            if (performance.now() - start < 380) requestAnimationFrame(sample);
            else resolve(samples);
        };
        requestAnimationFrame(sample);
    }));
    assert.ok(fade.some(value => value > 0.02 && value < 0.98), 'Visibility must fade instead of switching instantly');
    await waitVisibility(0);
    await scroller.evaluate(el => { el.scrollTop = 160; });
    await waitVisibility(1);
    await waitVisibility(0);
    await page.screenshot({ path: path.join(output, 'home-scrollbar-hidden.png') });
    await scroller.evaluate(el => { el.scrollTop = 0; });
    const thumb = await scroller.evaluate(el => ({
        x: el.getBoundingClientRect().right - 5,
        y: el.getBoundingClientRect().top + Math.max(8, el.clientHeight * el.clientHeight / el.scrollHeight / 2),
    }));
    await page.mouse.move(thumb.x, thumb.y);
    await page.mouse.down();
    await page.mouse.move(thumb.x, thumb.y + 160, { steps: 12 });
    await page.mouse.up();
    const dragged = await scroller.evaluate(el => el.scrollTop);
    assert.ok(dragged > 100, 'Dragging the native thumb must scroll downward');
    assert.equal(await scroller.evaluate(el => el.classList.contains('cursor-grabbing')), false);
    await scroller.evaluate(el => { el.scrollTop = 0; });
    return { autoHide: true, edgeHoverReveal: true, contentHoverHidden: true, scrollReveal: true, animatedFade: true, stableWidth: true, nativeThumbDrag: dragged };
}
