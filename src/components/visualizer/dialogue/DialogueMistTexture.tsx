import { useLayoutEffect, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { parseColorChannels } from '../colorMix';
import { createDialogueMistRenderer } from './dialogueMistRenderer';

// 时钟变化才请求绘制，局部最多 30fps；暂停、离屏、隐藏和散雾完成后没有常驻绘制循环。
export function DialogueMistTexture({ currentTime, progress, color, seed }: {
    currentTime: MotionValue<number>; progress: MotionValue<number>; color: string; seed: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const colorRef = useRef([1, 1, 1]);
    const invalidateRef = useRef(() => {});
    useLayoutEffect(() => {
        const rgb = parseColorChannels(color);
        colorRef.current = rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255] : [1, 1, 1];
        invalidateRef.current();
    }, [color]);
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let renderer = createDialogueMistRenderer(canvas);
        let disposed = false, visible = true, frame = 0, lastDraw = -Infinity, draws = 0;
        let width = canvas.clientWidth, height = canvas.clientHeight;
        const cancel = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
        const draw = (timestamp: number) => {
            frame = 0;
            if (disposed || !renderer || !visible || document.hidden || progress.get() >= 1) return;
            if (timestamp - lastDraw < 1000 / 30) { frame = requestAnimationFrame(draw); return; }
            renderer.draw(width, height, currentTime.get() + seed * 19.731, progress.get(), colorRef.current);
            canvas.dataset.mistFrame = String(++draws);
            canvas.dataset.mistRenderer = 'webgl';
            lastDraw = timestamp;
        };
        const invalidate = () => {
            if (!disposed && renderer && !frame && visible && !document.hidden && progress.get() < 1) frame = requestAnimationFrame(draw);
        };
        invalidateRef.current = invalidate;
        const unsubscribeTime = currentTime.on('change', invalidate);
        const unsubscribeProgress = progress.on('change', () => { if (progress.get() >= 1) cancel(); else invalidate(); });
        const resize = new ResizeObserver(entries => {
            const bounds = entries[0]?.contentRect;
            if (bounds && (width !== bounds.width || height !== bounds.height)) {
                width = bounds.width; height = bounds.height; invalidate();
            }
        });
        resize.observe(canvas);
        const intersection = new IntersectionObserver(entries => {
            visible = entries[0]?.isIntersecting ?? false;
            if (visible) invalidate(); else cancel();
        });
        intersection.observe(canvas);
        const visibility = () => { if (document.hidden) cancel(); else invalidate(); };
        const lost = (event: Event) => { event.preventDefault(); cancel(); renderer = null; };
        const restored = () => { renderer = createDialogueMistRenderer(canvas); invalidate(); };
        canvas.addEventListener('webglcontextlost', lost);
        canvas.addEventListener('webglcontextrestored', restored);
        document.addEventListener('visibilitychange', visibility);
        invalidate();
        return () => {
            disposed = true; cancel(); invalidateRef.current = () => {};
            unsubscribeTime(); unsubscribeProgress(); resize.disconnect(); intersection.disconnect();
            document.removeEventListener('visibilitychange', visibility);
            canvas.removeEventListener('webglcontextlost', lost);
            canvas.removeEventListener('webglcontextrestored', restored);
            renderer?.destroy();
        };
    }, [currentTime, progress, seed]);
    return <canvas ref={canvasRef} aria-hidden="true" data-dialogue-mist-texture
        className="absolute inset-0 block h-full w-full" />;
}
