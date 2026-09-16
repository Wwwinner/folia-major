import { readFile } from 'node:fs/promises';

// 从本机 HAR 选择成功搜索，只把请求上下文交给核对进程，不记录凭据值。
export const searchPath = '/walkman/api/search/keyword';
const allowedHeaders = new Set(['user-agent', 'accept', 'accept-encoding', 'content-type',
    'sm_device', 'signature', 'x-uuid', 'token', 'cookie', 'authorization']);

// 捕获文件是不可信输入；仅接受固定饭角 HTTPS 搜索端点及成功的 JSON 响应。
export async function loadSearchCapture(path) {
    const har = JSON.parse(await readFile(path, 'utf8'));
    const entries = Array.isArray(har.log?.entries) ? har.log.entries : [];
    for (const [entryIndex, entry] of entries.entries()) {
        try {
            const url = new URL(entry.request.url);
            if (entry.request.method !== 'GET' || url.protocol !== 'https:' || url.username
                || url.password || url.port || url.hostname !== 'api.fanjiao.co'
                || url.pathname !== searchPath || entry.response?.status !== 200) continue;
            const content = entry.response.content;
            const text = content.encoding === 'base64'
                ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
            const response = JSON.parse(text);
            if (response.code !== 0 || !Array.isArray(response.data?.list)) continue;
            const headers = Object.fromEntries(entry.request.headers
                .filter(header => allowedHeaders.has(header.name.toLowerCase()))
                .map(header => [header.name.toLowerCase(), header.value]));
            return { entryIndex, url, headers, body: entry.request.postData?.text || '' };
        } catch { /* 跳过无关或损坏的条目，不输出它的原始内容。 */ }
    }
    throw new Error('No successful Fanjiao search capture found.');
}
