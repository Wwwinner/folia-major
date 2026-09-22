// HLS 的非致命停滞兜底：只监测正在播放的音轨，先轻量恢复，仍不前进再交给既有取源恢复。
type StallRecoveryOptions = {
    restartLoad: (position: number) => void;
    onFatal: () => void;
    onRecovery?: (action: 'nudge' | 'reload' | 'refresh', position: number) => void;
    now?: () => number;
    networkWaitMs?: number;
};

/** 给内建 HLS 恢复留出时间；暂停、拖动、切源时不抢占用户操作，也不自行调用 play。 */
export function createHlsStallRecovery(media: HTMLAudioElement, options: StallRecoveryOptions) {
    const now = options.now ?? (() => performance.now());
    let timer: ReturnType<typeof setInterval> | undefined;
    let checkpoint = media.currentTime;
    let lastProgressAt = now();
    let attempted = false;
    let disposed = false;
    const stop = () => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
    };
    const reset = () => { checkpoint = media.currentTime; lastProgressAt = now(); attempted = false; };
    const tick = () => {
        if (disposed || media.paused || media.ended || media.error || media.playbackRate === 0) { stop(); return; }
        const position = media.currentTime;
        if (!Number.isFinite(position)) {
            checkpoint = position; lastProgressAt = now(); return;
        }
        if (Math.abs(position - checkpoint) > 0.25) { reset(); return; }
        const idleMs = now() - lastProgressAt;
        let target: number | undefined;
        for (let index = 0; index < media.buffered.length; index++) {
            const start = media.buffered.start(index), end = media.buffered.end(index);
            if (start <= position + 0.25 && end > position + 0.1) {
                target = Math.max(position + 0.05, start + 0.01);
                break;
            }
        }
        // 缺片时给主进程完整下载预算；已有缓冲的小断点仍可尽快修复。
        const graceMs = attempted ? options.networkWaitMs ?? 20000
            : target === undefined ? options.networkWaitMs ?? (media.readyState === 0 ? 25000 : 10000) : 10000;
        if (idleMs < graceMs) return;
        if (attempted) {
            stop();
            options.onRecovery?.('refresh', position);
            options.onFatal();
            return;
        }
        attempted = true;
        lastProgressAt = now();
        // 只跨越很小的断点，不能为了恢复而跳过一整段台词。
        if (target !== undefined) {
            options.onRecovery?.('nudge', position);
            media.currentTime = target;
        } else {
            options.onRecovery?.('reload', position);
            options.restartLoad(position);
        }
    };
    const start = () => {
        if (disposed || media.paused || timer !== undefined) return;
        reset();
        timer = setInterval(tick, 1000);
    };
    // 浏览器的 seeking 可因缺片一直为 true；只给每次新跳转宽限期，不能永久停止监测。
    const seek = () => { checkpoint = media.currentTime; lastProgressAt = now(); };
    media.addEventListener('seeking', seek);
    for (const event of ['play', 'playing', 'waiting', 'stalled']) media.addEventListener(event, start);
    for (const event of ['pause', 'ended', 'emptied', 'error']) media.addEventListener(event, stop);
    start();
    return () => {
        disposed = true;
        stop();
        media.removeEventListener('seeking', seek);
        for (const event of ['play', 'playing', 'waiting', 'stalled']) media.removeEventListener(event, start);
        for (const event of ['pause', 'ended', 'emptied', 'error']) media.removeEventListener(event, stop);
    };
}
