import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { createFanjiaoClient } from '../nativeClient.mjs';
import { createPlaybackSession } from './session.mjs';

// 本机单集验证服务；只暴露白名单静态文件、标准字幕和已处理的媒体片段。
const { values } = parseArgs({ options: {
    'secret-file': { type: 'string' }, port: { type: 'string', default: '3411' },
} });
const secret = process.env.FANJIAO_SIGNATURE_SECRET
    || (values['secret-file'] ? (await readFile(values['secret-file'], 'utf8')).trim() : '');
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const require = createRequire(import.meta.url);
const files = new Map([
    ['/', [new URL('./preview.html', import.meta.url), 'text/html; charset=utf-8']],
    ['/preview.mjs', [new URL('./preview.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
    ['/preview.css', [new URL('./preview.css', import.meta.url), 'text/css; charset=utf-8']],
    ['/hls.min.js', [require.resolve('hls.js/dist/hls.min.js'), 'text/javascript; charset=utf-8']],
]);
const session = createPlaybackSession(createFanjiaoClient(secret), { onEvent: event => console.log(JSON.stringify(event)) });
let origin;

function send(response, status, type, body) {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
    response.end(body);
}

// 只在 loopback 接受本验证页面的请求，禁止任意远端 URL 或账号操作入口。
const server = createServer(async (request, response) => {
    if (!origin || request.headers.host !== new URL(origin).host
        || (request.headers.origin && request.headers.origin !== origin)) {
        send(response, 403, 'text/plain', 'Forbidden'); return;
    }
    const path = new URL(request.url, origin).pathname;
    try {
        if (request.method === 'GET' && files.has(path)) {
            const [file, type] = files.get(path);
            send(response, 200, type, await readFile(file));
        } else if (request.method === 'GET' && path === '/api/episode') {
            send(response, 200, 'application/json', JSON.stringify(await session.snapshot()));
        } else if (request.method === 'GET' && path === '/api/stats') {
            send(response, 200, 'application/json', JSON.stringify(session.stats()));
        } else if (request.method === 'POST' && path === '/api/test-expire') {
            session.expire();
            send(response, 200, 'application/json', JSON.stringify({ expiredLocally: true }));
        } else if (request.method === 'GET' && path === '/media/index.m3u8') {
            send(response, 200, 'application/vnd.apple.mpegurl', await session.playlist());
        } else if (request.method === 'GET' && /^\/media\/segment\/\d+\.ts$/.test(path)) {
            const index = Number(path.match(/(\d+)\.ts$/)[1]);
            send(response, 200, 'video/mp2t', await session.segment(index));
        } else send(response, 404, 'text/plain', 'Not found');
    } catch (error) {
        const message = String(error.message).replace(/https?:\/\/\S+/g, '[url]').slice(0, 200);
        console.error(JSON.stringify({ event: 'probe-error', path, message }));
        send(response, 502, 'application/json', JSON.stringify({ error: message }));
    }
});
server.listen(port, '127.0.0.1', async () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    await mkdir('test-results/fanjiao-playback', { recursive: true });
    await writeFile('test-results/fanjiao-playback/server.json', JSON.stringify({ origin, pid: process.pid }));
    console.log(`Fanjiao playback probe: ${origin}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
