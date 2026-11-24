import { createHmac, randomUUID } from 'node:crypto';
import { deriveMediaKey, encryptClientRandom } from './vodCrypto';
import type { FanjiaoFetch } from './client';
import { record, text, type FanjiaoRecord } from './normalize';

// sources/fanjiao/main/vod.ts
// 将已获准返回的单集临时播放信息解析成内部媒体会话；不向 UI 返回凭据。

export interface FanjiaoMediaTrack {
    definition: string;
    format: string;
    codec: string | null;
    encrypted: boolean;
    size: number;
    duration: number;
}

export interface FanjiaoMedia {
    url: string;
    key: Buffer | null;
    metadata: {
        definition: string;
        format: string;
        duration: number;
        size: number;
        codec: string | null;
        encrypted: boolean;
        encryption: string | null;
        available: FanjiaoMediaTrack[];
    };
}

export type FanjiaoResolveMedia = (
    payload: FanjiaoRecord,
    definition: string,
    signal: AbortSignal,
) => Promise<FanjiaoMedia>;

const defaultFetch: FanjiaoFetch = (url, init) => fetch(url, init);
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export function signVod(params: Record<string, string>, secret: string): string {
    const canonical = Object.keys(params).sort().map(key => `${encode(key)}=${encode(params[key])}`).join('&');
    return createHmac('sha1', `${secret}&`).update(`GET&%2F&${encode(canonical)}`).digest('base64');
}

const trackOf = (raw: FanjiaoRecord): FanjiaoMediaTrack => ({
    definition: text(raw.Definition),
    format: text(raw.Format),
    codec: typeof raw.CodecName === 'string' ? raw.CodecName : null,
    encrypted: Number(raw.Encrypt) === 1,
    size: Number(raw.Size),
    duration: Number(raw.Duration),
});

export async function resolveVod(
    payload: FanjiaoRecord,
    definition = 'FD',
    signal?: AbortSignal,
    fetchImpl: FanjiaoFetch = defaultFetch,
): Promise<FanjiaoMedia> {
    const playAuth = payload.play_auth;
    const encryptedSource = payload.encrypt_src;
    if (typeof playAuth !== 'string' || !playAuth
        || typeof encryptedSource !== 'string' || !encryptedSource) {
        throw new Error('Episode has no current media authorization');
    }
    const authorization: unknown = JSON.parse(Buffer.from(playAuth, 'base64').toString('utf8'));
    const auth = record(authorization);
    const accessKeyId = typeof auth.AccessKeyId === 'string' ? auth.AccessKeyId : '';
    const accessKeySecret = typeof auth.AccessKeySecret === 'string' ? auth.AccessKeySecret : '';
    const securityToken = typeof auth.SecurityToken === 'string' ? auth.SecurityToken : '';
    const authInfo = typeof auth.AuthInfo === 'string' ? auth.AuthInfo : '';
    if (!accessKeyId || !accessKeySecret || !securityToken || !authInfo) {
        throw new Error('Incomplete media authorization');
    }
    const region = typeof auth.Region === 'string' ? auth.Region : 'cn-shanghai';
    if (!/^[a-z]+(?:-[a-z0-9]+)+$/.test(region)) throw new Error('Invalid media region');
    const clientRandom = randomUUID();
    const params: Record<string, string> = {
        AccessKeyId: accessKeyId, Action: 'GetPlayInfo', AuthInfo: authInfo,
        AuthTimeout: '3600', Channel: 'Android', Format: 'JSON', Formats: 'mp4,m3u8,mp3,flv',
        PlayerVersion: '', SecurityToken: securityToken, SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: randomUUID(), SignatureVersion: '1.0', Version: '2017-03-21',
        VideoId: encryptedSource, Rand: encryptClientRandom(clientRandom),
        PlayConfig: '{"Damn":"Nothing to do, just to prevent errors"}',
    };
    params.Signature = signVod(params, accessKeySecret);
    const query = Object.entries(params).map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
    const response = await fetchImpl(`https://vod.${region}.aliyuncs.com/?${query}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AliPlayer/7.10.0' },
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    const body: unknown = await response.json();
    const document = record(body);
    if (!response.ok) {
        const code = typeof document.Code === 'string' && /^[A-Za-z0-9_.-]+$/.test(document.Code) ? document.Code : 'unknown';
        throw new Error(`VOD HTTP ${response.status} (${code})`);
    }
    const raw = record(document.PlayInfoList).PlayInfo;
    const rawTracks: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    const tracks = rawTracks.map(record);
    const candidates = tracks.filter(track => track.Format === 'm3u8'
        && (!Number(track.Encrypt) || track.EncryptType === 'AliyunVoDEncryption'));
    const selected = candidates.find(track => text(track.Definition).toUpperCase() === definition)
        || candidates.find(track => text(track.Definition).toUpperCase() === 'FD');
    if (!selected || typeof selected.PlayURL !== 'string' || !selected.PlayURL) throw new Error('Requested media quality unavailable');
    const encrypted = Number(selected.Encrypt) === 1;
    let key: Buffer | null = null;
    if (encrypted) {
        const serverRandom = selected.Rand;
        const wrappedKey = selected.Plaintext;
        if (typeof serverRandom !== 'string' || typeof wrappedKey !== 'string') throw new Error('Invalid media session key');
        key = deriveMediaKey(clientRandom, serverRandom, wrappedKey);
    }
    return {
        url: selected.PlayURL, key,
        metadata: { definition: text(selected.Definition), format: text(selected.Format), duration: Number(selected.Duration),
            size: Number(selected.Size), codec: typeof selected.CodecName === 'string' ? selected.CodecName : null, encrypted,
            encryption: typeof selected.EncryptType === 'string' ? selected.EncryptType : null,
            available: tracks.map(trackOf) },
    };
}
