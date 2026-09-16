import { constants, createDecipheriv, createHash, publicEncrypt } from 'node:crypto';

// Aliyun 媒体会话协议适配；临时媒体密钥只保留在 Node 进程内。
const publicKey = `-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAIcLeIt2wmIyXckgNhCGpMTAZyBGO+nk0/IdOrhIdfRR
gBLHdydsftMVPNHrRuPKQNZRslWE1vvgx80w9lCllIUCAwEAAQ==
-----END PUBLIC KEY-----`;
const md5 = bytes => createHash('md5').update(bytes).digest('hex');

export function encryptClientRandom(value) {
    return publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING },
        Buffer.from(value)).toString('base64');
}

function decryptCbc(bytes, key, iv) {
    const decipher = createDecipheriv('aes-128-cbc', key, iv).setAutoPadding(false);
    const result = Buffer.concat([decipher.update(bytes), decipher.final()]);
    const padding = result.at(-1);
    return padding >= 1 && padding <= 16 && padding <= result.length
        ? result.subarray(0, result.length - padding) : result;
}

// 与参考引擎的媒体会话握手一致，不从 HAR 复用已过期的授权或密钥。
export function deriveMediaKey(clientRandom, serverRandom, wrappedKey) {
    const firstKey = Buffer.from(md5(clientRandom).slice(8, 24));
    const randomBytes = decryptCbc(Buffer.from(serverRandom, 'base64'), firstKey, firstKey);
    const secondKey = Buffer.from(md5(Buffer.concat([Buffer.from(clientRandom), randomBytes])).slice(8, 24));
    const encodedKey = decryptCbc(Buffer.from(wrappedKey, 'base64'), secondKey, firstKey);
    const key = Buffer.from(encodedKey.toString('ascii'), 'base64');
    if (key.length !== 16) throw new Error('Invalid media session key');
    return key;
}
