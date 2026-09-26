import { createHmac, randomUUID } from 'node:crypto';
import { deriveMediaKey, encryptClientRandom } from './vodCrypto.mjs';

// 将已获准返回的单集临时播放信息解析成内部媒体会话；不向 UI 返回凭据。
const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export function signVod(params, secret) {
    const canonical = Object.keys(params).sort().map(key => `${encode(key)}=${encode(params[key])}`).join('&');
    return createHmac('sha1', `${secret}&`).update(`GET&%2F&${encode(canonical)}`).digest('base64');
}

export async function resolveVod(payload, definition = 'FD', signal) {
    if (!payload.play_auth || !payload.encrypt_src) throw new Error('Episode has no current media authorization');
    const auth = JSON.parse(Buffer.from(payload.play_auth, 'base64').toString('utf8'));
    if (!['AccessKeyId', 'AccessKeySecret', 'SecurityToken', 'AuthInfo'].every(key => typeof auth[key] === 'string' && auth[key])) {
        throw new Error('Incomplete media authorization');
    }
    const region = auth.Region || 'cn-shanghai';
    if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(region)) throw new Error('Invalid media region');
    const clientRandom = randomUUID();
    const params = {
        AccessKeyId: auth.AccessKeyId, Action: 'GetPlayInfo', AuthInfo: auth.AuthInfo,
        AuthTimeout: '3600', Channel: 'Android', Format: 'JSON', Formats: 'mp4,m3u8,mp3,flv',
        PlayerVersion: '', SecurityToken: auth.SecurityToken, SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: randomUUID(), SignatureVersion: '1.0', Version: '2017-03-21',
        VideoId: payload.encrypt_src, Rand: encryptClientRandom(clientRandom),
        PlayConfig: '{"Damn":"Nothing to do, just to prevent errors"}',
    };
    params.Signature = signVod(params, auth.AccessKeySecret);
    const query = Object.entries(params).map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
    const response = await fetch(`https://vod.${region}.aliyuncs.com/?${query}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AliPlayer/7.10.0' },
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    const document = await response.json();
    if (!response.ok) {
        const code = /^[A-Za-z0-9_.-]+$/.test(document.Code || '') ? document.Code : 'unknown';
        throw new Error(`VOD HTTP ${response.status} (${code})`);
    }
    const raw = document.PlayInfoList?.PlayInfo;
    const tracks = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const candidates = tracks.filter(track => track.Format === 'm3u8'
        && (!Number(track.Encrypt) || track.EncryptType === 'AliyunVoDEncryption'));
    const selected = candidates.find(track => String(track.Definition).toUpperCase() === definition)
        || candidates.find(track => String(track.Definition).toUpperCase() === 'FD');
    if (!selected?.PlayURL) throw new Error('Requested media quality unavailable');
    const encrypted = Number(selected.Encrypt) === 1;
    return {
        url: selected.PlayURL, key: encrypted ? deriveMediaKey(clientRandom, selected.Rand, selected.Plaintext) : null,
        metadata: { definition: selected.Definition, format: selected.Format, duration: Number(selected.Duration),
            size: Number(selected.Size), codec: selected.CodecName || null, encrypted,
            encryption: selected.EncryptType || null, available: tracks.map(track => ({
                definition: track.Definition, format: track.Format, codec: track.CodecName || null,
                encrypted: Number(track.Encrypt) === 1, size: Number(track.Size), duration: Number(track.Duration),
            })) },
    };
}
