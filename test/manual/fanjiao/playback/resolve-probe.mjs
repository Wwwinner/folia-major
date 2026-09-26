import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createFanjiaoClient } from '../nativeClient.mjs';
import { resolveVod } from './vod.mjs';

// 仅验证用户捕获的 47 秒零价格福利分集，不遍历付费节目或枚举访问权限。
const secret = process.env.FANJIAO_SIGNATURE_SECRET || (await readFile(process.argv[2], 'utf8')).trim();
const client = createFanjiaoClient(secret);
try {
    const payload = await client.get('/walkman/api/audio/info', { audio_id: 120361 });
    if (payload.audio_id !== 120361 || payload.album_id !== 111726 || payload.price !== 0 || payload.is_public !== 1) {
        throw new Error('Public sample metadata changed; recheck sample before media requests');
    }
    const media = await resolveVod(payload);
    const result = { episode: { id: payload.audio_id, albumId: payload.album_id, title: payload.name,
        duration: payload.duration, price: payload.price, access: payload.access_info }, media: media.metadata };
    await mkdir('test-results/fanjiao-playback', { recursive: true });
    await writeFile('test-results/fanjiao-playback/resolution.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
} catch (error) {
    console.error(error.message.replace(/https?:\/\/\S+/g, '[url]'));
    process.exitCode = 1;
}
