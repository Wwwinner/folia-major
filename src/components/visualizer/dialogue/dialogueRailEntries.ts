import type { Line } from '../../../types';
import type { MonetVisibleLineEntry } from '../monet/monetLyricsModel';

// 对白的自动跟随窗口优先保留未结束句，手动回看仍使用莫奈的历史窗口。
export function retainDialogueActiveEntries(entries: MonetVisibleLineEntry[], lines: Line[], active: ReadonlySet<number>, startedCount = lines.length): MonetVisibleLineEntry[] {
    const retained = new Map(entries.map(entry => [entry.index, entry]));
    const anchor = entries.find(entry => entry.offset === 0)?.index ?? lines.length - 1;
    const keep = [...active];
    // 即将行成为布局焦点时，仍保留原来的三句收听上下文。
    for (let index = Math.max(0, startedCount - 3); index < startedCount; index++) keep.push(index);
    for (const index of keep) {
        const line = lines[index];
        if (line && !retained.has(index)) retained.set(index, {
            key: `${index}-${line.startTime}-${line.fullText}`, line, index, offset: index - anchor, status: 'active',
        });
    }
    return [...retained.values()].sort((a, b) => a.index - b.index)
        .map(entry => ({ ...entry, status: entry.index >= startedCount ? 'waiting' : active.has(entry.index) ? 'active' : 'passed' }));
}

interface DialogueLayoutEntry { status: string; y: number; scaledHeight: number; }

/** 保留活动组的可读区域；只在空间不足时收起组内历史，不删活动句或改变时间顺序。 */
export function fitDialogueActiveGroup<T extends DialogueLayoutEntry>(entries: T[], railHeight: number, gap: (a: T, b: T) => number): T[] {
    const first = entries.findIndex(entry => entry.status === 'active');
    const last = entries.findLastIndex(entry => entry.status === 'active');
    if (first < 0 || last === first) return entries;
    const group = entries.slice(first, last + 1);
    const height = () => group.reduce((total, entry, index) => total + entry.scaledHeight
        + (index ? gap(group[index - 1], entry) : 0), 0);
    while (height() > railHeight * 0.76) {
        const history = group.findIndex(entry => entry.status !== 'active');
        if (history < 0) break;
        group.splice(history, 1);
    }
    return [...entries.slice(0, first), ...group, ...entries.slice(last + 1)];
}

/** 以整个活动组为焦点，避免最新一句居中时把较早的重叠句推到上沿之外。 */
export function centerDialogueActiveGroup<T extends DialogueLayoutEntry>(entries: T[], railHeight: number): T[] {
    const first = entries.find(entry => entry.status === 'active');
    const last = entries.findLast(entry => entry.status === 'active');
    if (!first || !last) return entries;
    const center = (first.y + last.y + last.scaledHeight) / 2;
    const shift = railHeight * 0.46 - center;
    return entries.map(entry => ({ ...entry, y: entry.y + shift }));
}
