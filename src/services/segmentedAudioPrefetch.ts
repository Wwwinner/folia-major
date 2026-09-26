// 仅预热已由 Omni 解析的饭角会话首片；主进程负责下载/解密/缓存，不创建音频节点。
export async function prefetchSegmentedAudioStart(source: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    let url: URL;
    try { url = new URL(source); } catch { return false; }
    if (url.protocol !== 'folia-hls:' || url.hostname !== 'fanjiao' || url.search || url.hash
        || !/^\/[1-9]\d{0,14}\/[a-f0-9]{48}\/index\.m3u8$/.test(url.pathname)) return false;
    try {
        const response = await fetch(new URL('segment/0.ts', url).href, { signal });
        if (!response.ok) { await response.body?.cancel(); return false; }
        await response.arrayBuffer();
        return true;
    } catch { return false; }
}
