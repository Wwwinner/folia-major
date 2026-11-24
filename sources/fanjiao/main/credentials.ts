import { readFileSync } from 'node:fs';

// sources/fanjiao/main/credentials.ts
// 饭角签名凭据只从环境读取：FANJIAO_SIGNATURE_SECRET，或显式 FANJIAO_SIGNATURE_SECRET_FILE 指向的文件。
// 不猜旧桌面版的 userData / appPath 位置，也不读旧 profile；路径按环境里写的直接用。

export function readSigningSecret(
    env: NodeJS.ProcessEnv = process.env,
    readFile: (filename: string) => string = filename => readFileSync(filename, 'utf8'),
): string {
    const direct = env.FANJIAO_SIGNATURE_SECRET;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const filename = env.FANJIAO_SIGNATURE_SECRET_FILE;
    if (!filename) return '';
    try { return readFile(filename).trim(); } catch { return ''; }
}
