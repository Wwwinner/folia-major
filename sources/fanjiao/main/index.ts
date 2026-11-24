import type { FoliumSourceMainApi } from '@folia/folium';
import { fetchChromiumMedia } from './chromiumMediaFetch';
import { readSigningSecret } from './credentials';
import { createFanjiaoService } from './service';

// sources/fanjiao/main/index.ts
// 饭角音源模组的 main 入口：签名的目录请求、Chromium 媒体字节流、本地 HLS 会话和字幕都留在主进程。
// 窗口经 folium.rpc 的 `fanjiao` 发操作；签名凭据只从环境读，不读写旧桌面版的 profile。

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const service = createFanjiaoService({
        secret: readSigningSecret(),
        mediaUrl: rest => api.media.url('stream', rest),
        fetch: (url, init) => api.net.fetch(url, init),
        // Chromium 的字节流适配器保留在媒体下载上：字幕响应头可能含非 Latin 文件名。
        fetchMedia: (url, init) => fetchChromiumMedia({ request: options => api.net.request(options) }, url, init),
        warn: (message, details) => api.log.warn(message, details),
    });
    // 播放列表和分片只经这条本机路由，token 不可预测；相对分片地址按同一前缀解析。
    api.media.serve('stream', request => service.handleMedia(request.path));
    api.rpc.handle('fanjiao', (operation, params) => service.rpc(operation, params));
    // 停用、重载或退出时释放所有媒体会话；dispose 可以重复调用，晚到的异步答案不会再留下会话。
    api.onBeforeUnload(() => service.dispose());
    api.onDispose(() => service.dispose());
}
