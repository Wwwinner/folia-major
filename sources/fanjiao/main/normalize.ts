// sources/fanjiao/main/normalize.ts
// 上游 JSON 的窄化：目录 DTO 只读自己列出的字段，非对象按空对象处理，不把凭据或任意字段带过 RPC。

export type FanjiaoRecord = Record<string, unknown>;

/** An upstream object; arrays and scalars are no object at all. */
export const record = (value: unknown): FanjiaoRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as FanjiaoRecord : {}
);

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const number = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** A request the caller made with values this source does not accept; the RPC answer keeps it distinct. */
export const invalid = (message: string): Error & { code: 'invalid' } => (
    Object.assign(new Error(message), { code: 'invalid' as const })
);
