import * as twgl from 'twgl.js';
import { MIST_FRAGMENT_SHADER, MIST_VERTEX_SHADER } from './dialogueMistShader';

// 复用项目的 twgl，限定单片雾的像素预算；不建立 Three/Pixi 场景或读取音频数据。
export function createDialogueMistRenderer(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: true, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    if (!gl) return null;
    const program = twgl.createProgramInfo(gl, [MIST_VERTEX_SHADER, MIST_FRAGMENT_SHADER]);
    if (!program) return null;
    const buffer = twgl.createBufferInfoFromArrays(gl, {
        a_position: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1] },
    });
    gl.clearColor(0, 0, 0, 0);
    return {
        draw(width: number, height: number, time: number, reveal: number, color: number[]) {
            const scale = Math.min(1, 384 / Math.max(width, 1), 128 / Math.max(height, 1));
            const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale));
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            gl.viewport(0, 0, w, h);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program.program);
            twgl.setBuffersAndAttributes(gl, program, buffer);
            twgl.setUniforms(program, { u_time: time, u_reveal: reveal, u_color: color });
            twgl.drawBufferInfo(gl, buffer);
        },
        destroy() {
            for (const shader of gl.getAttachedShaders(program.program) ?? []) gl.deleteShader(shader);
            gl.deleteProgram(program.program);
            if (buffer.attribs?.a_position?.buffer) gl.deleteBuffer(buffer.attribs.a_position.buffer);
            // StrictMode 会在同一个 canvas 上重跑 effect；仅真正移除的画布释放 context。
            queueMicrotask(() => { if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext(); });
        },
    };
}
