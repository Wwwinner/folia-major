// 每句开始前一秒在原排版位置凝聚；远期占位不显示，暂停和回退随播放时钟。
export function dialogueMistAnticipation(time: number, start: number) {
    const phase = Math.min(1, Math.max(0, time - start + 1));
    return phase * phase * (3 - 2 * phase);
}

// 短句在自身结束前显露完整，不另建动画计时器。
export function dialogueMistProgress(time: number, start: number, end: number) {
    if (time < start) return 0;
    const duration = Math.min(0.65, Math.max(0, end - start) * 0.35);
    if (duration === 0) return 1;
    const linear = Math.min(1, Math.max(0, (time - start) / duration));
    return 1 - Math.pow(1 - linear, 3);
}

// 文字到点显现，雾先随行起步，再散开；使用同一播放进度，暂停/短句/回退仍同步。
export function dialogueMistDissolveProgress(revealProgress: number) {
    const phase = Math.min(1, Math.max(0, (revealProgress - 0.42) / 0.58));
    return phase * phase * (3 - 2 * phase);
}
