import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { loadSearchCapture, searchPath } from './searchCapture.mjs';

// 使用本机成功搜索 HAR 做有限的字段对照；不输出或保存请求凭据、用户资料。
const { values } = parseArgs({ options: {
    har: { type: 'string' },
    'secret-file': { type: 'string' },
    out: { type: 'string', default: 'test-results/fanjiao-search-har-check.json' },
} });
if (!values.har) throw new Error('--har is required.');
const { entryIndex, url, headers, body } = await loadSearchCapture(values.har);
const credential = process.env.FANJIAO_SIGNATURE_SECRET
    || (values['secret-file'] ? (await readFile(values['secret-file'], 'utf8')).trim() : '');
const params = Object.fromEntries(url.searchParams);
const generatedSignature = credential ? createHash('md5')
    .update(Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&') + credential)
    .digest('hex') : null;
const report = { observedAt: new Date().toISOString(), entryIndex, method: 'GET', path: searchPath,
    keyword: params.keyword, signatureMatchesCurrentRule: generatedSignature === null
        ? null : generatedSignature === headers.signature,
    variants: [] };

// https.request 保留原 GET body；响应限长、超时，异常只记录类型和错误码。
function fetchSearch(requestHeaders, requestBody) {
    return new Promise((resolve, reject) => {
        const activeHeaders = { ...requestHeaders };
        if (requestBody) activeHeaders['content-length'] = String(Buffer.byteLength(requestBody));
        const req = httpsRequest(url, { method: 'GET', headers: activeHeaders }, response => {
            const chunks = [];
            let length = 0;
            response.on('error', reject);
            response.on('data', chunk => {
                length += chunk.length;
                if (length > 4 * 1024 * 1024) req.destroy(new Error('Response exceeds probe limit'));
                else chunks.push(chunk);
            });
            response.on('end', () => {
                try {
                    let bytes = Buffer.concat(chunks);
                    const options = { maxOutputLength: 4 * 1024 * 1024 };
                    const encoding = response.headers['content-encoding'];
                    if (encoding === 'gzip') bytes = gunzipSync(bytes, options);
                    else if (encoding === 'br') bytes = brotliDecompressSync(bytes, options);
                    else if (encoding === 'deflate') bytes = inflateSync(bytes, options);
                    const data = JSON.parse(bytes.toString('utf8'));
                    resolve({ status: response.statusCode, data });
                } catch (error) { reject(error); }
            });
        });
        req.setTimeout(20000, () => req.destroy(new Error('Request timeout')));
        req.on('error', reject);
        if (requestBody) req.write(requestBody);
        req.end();
    });
}

async function save() {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
}

// 只有成功基线可用时才继续减字段，最多六次请求，不重试、不访问其他端点。
const variants = [
    { name: 'captured', omit: [] },
    { name: 'without-sm-device', omit: ['sm_device'] },
    { name: 'without-x-uuid', omit: ['x-uuid'] },
    { name: 'without-device-context', omit: ['sm_device', 'x-uuid'] },
    { name: 'without-body', omit: [], noBody: true },
    ...(generatedSignature ? [{ name: 'regenerated-signature', omit: [], regenerate: true }] : []),
];
for (const variant of variants) {
    const requestHeaders = { ...headers };
    for (const key of variant.omit) delete requestHeaders[key];
    if (variant.regenerate) requestHeaders.signature = generatedSignature;
    const row = { variant: variant.name, headerNames: Object.keys(requestHeaders).sort(),
        hasBody: !variant.noBody && !!body };
    report.variants.push(row);
    try {
        const { status, data } = await fetchSearch(requestHeaders, variant.noBody ? '' : body);
        row.httpStatus = status;
        row.code = data.code;
        row.success = status === 200 && data.code === 0 && Array.isArray(data.data?.list);
        row.count = Array.isArray(data.data?.list) ? data.data.list.length : null;
        row.paging = data.data?.paging ? Object.fromEntries(Object.entries(data.data.paging)
            .filter(([, value]) => typeof value === 'number')) : null;
        row.albumIds = Array.isArray(data.data?.list) ? data.data.list.map(item => item.album_id) : [];
    } catch (error) {
        row.success = false;
        row.error = { name: error.name, code: error.code || null };
    }
    console.log(JSON.stringify(row));
    await save();
    if (variant.name === 'captured' && !row.success) { process.exitCode = 1; break; }
}
console.log(JSON.stringify({ signatureMatchesCurrentRule: report.signatureMatchesCurrentRule,
    report: values.out }));
