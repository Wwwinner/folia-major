import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import app from '../../../sync-server/src/app';
import { D1Emulator } from '../../../sync-server/src/d1-emulator';
import { FanjiaoLocalState } from '../../../src/services/sync/fanjiaoLocalState';
import { exchangeFanjiaoData } from '../../../src/services/sync/fanjiaoSyncExchange';
import { MAX_FANJIAO_BATCH, MAX_FANJIAO_BODY, MAX_FANJIAO_RECORDS, mergeFanjiaoHistory, recordOrder, recordPayload, versionKey, ZERO_VERSION } from '../../../shared/fanjiaoSync.mjs';
import type { FanjiaoHistory, FanjiaoRecord } from '../../../shared/fanjiaoSync.mjs';

// Production client exchange against the shared Hono API, SQLite transactions and a real local HTTP boundary.
let db: D1Emulator;
let server: Server | undefined;
const env = () => ({ FOLIA_SYNC_DB: db, SYNC_TOKEN: 'fixture-token' });
const value = { position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90 };
const key = 'online:fanjiao:1';
const row = (counter: number, generation = ZERO_VERSION): FanjiaoRecord => ({ key, epoch: ZERO_VERSION, generation,
    version: { counter, device: 'a' }, deleted: false, value });
const request = (path: string, data?: unknown) => app.request(path, { method: data ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }, env());
const put = (history: FanjiaoHistory) => request('/fanjiao/history', { protocol: 1, history });
const read = async () => (await (await request('/fanjiao/history')).json()).history as FanjiaoHistory;
beforeEach(() => { db = new D1Emulator(':memory:'); });
afterEach(async () => { if (server) await new Promise<void>(resolve => { server!.close(() => resolve()); server!.closeAllConnections(); }); server = undefined; db.close(); });

describe('Fanjiao server', () => {
    it('initializes separate databases, advertises support and preserves legacy settings', async () => {
        expect((await (await request('/health')).json()).capabilities.fanjiaoSync).toBe(1);
        expect((await app.request('/fanjiao/history', {}, env())).status).toBe(401);
        const settings = { schemaVersion: 1, updatedAt: '2026-09-28T00:00:00Z', data: { backgroundOpacity: 0.5 } };
        await app.request('/settings', { method: 'PUT', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }, env());
        await put({ epoch: ZERO_VERSION, records: [row(1)] });
        expect(await (await request('/settings')).json()).toEqual(settings);
        expect((await read()).records).toHaveLength(1);
    });
    it('matches the pure merge across concurrent, repeated, reversed and reset operations', async () => {
        const old = row(999);
        const restart = { ...row(4, { counter: 3, device: 'b' }), value: { ...value, position: 0 } };
        await Promise.all([put({ epoch: ZERO_VERSION, records: [old] }), put({ epoch: ZERO_VERSION, records: [restart] })]);
        await put({ epoch: ZERO_VERSION, records: [old] });
        expect(await read()).toEqual(mergeFanjiaoHistory({ epoch: ZERO_VERSION, records: [old] }, { epoch: ZERO_VERSION, records: [restart] }));
        const deleted = { ...restart, generation: { counter: 5, device: 'b' }, version: { counter: 5, device: 'b' }, deleted: true, value: null };
        await put({ epoch: ZERO_VERSION, records: [deleted] });
        await put({ epoch: ZERO_VERSION, records: [old] });
        expect((await read()).records[0].deleted).toBe(true);
        await put({ epoch: { counter: 10, device: 'b' }, records: [] });
        await put({ epoch: ZERO_VERSION, records: [old] });
        expect((await read()).records).toEqual([]);
    });
    it('rejects a malformed batch atomically and rolls back failed emulator transactions', async () => {
        const before = { epoch: ZERO_VERSION, records: [row(1)] };
        await put(before);
        expect((await put({ epoch: ZERO_VERSION, records: [row(2), { ...row(3), key: 'online:other:2' }] })).status).toBe(400);
        expect(await read()).toEqual(before);
        await expect(db.batch([
            db.prepare("DELETE FROM fanjiao_records"),
            db.prepare('INSERT INTO missing_table (value) VALUES (1)'),
        ])).rejects.toThrow();
        expect(await read()).toEqual(before);
    });
    it('uses the same metadata tie-break for emoji and non-ASCII titles in both runtimes', async () => {
        const metadata = { name: '😀', albumId: '7', albumName: 'Album', coverUrl: '', author: '', kind: 'main' as const };
        const a = { ...row(1), value: { ...value, metadata } };
        const b = { ...row(1), value: { ...value, metadata: { ...metadata, name: '\uE000' } } };
        await put({ epoch: ZERO_VERSION, records: [a] }); await put({ epoch: ZERO_VERSION, records: [b] });
        expect(await read()).toEqual(mergeFanjiaoHistory({ epoch: ZERO_VERSION, records: [a] }, { epoch: ZERO_VERSION, records: [b] }));
    });
    it('enforces batch/body limits and rolls back capacity overflow without losing an earlier update', async () => {
        await put({ epoch: ZERO_VERSION, records: [row(1)] });
        expect((await put({ epoch: ZERO_VERSION, records: Array.from({ length: MAX_FANJIAO_BATCH + 1 }, (_, n) => ({ ...row(1), key: `online:fanjiao:${n}` })) })).status).toBe(400);
        expect((await request('/fanjiao/history', { padding: 'x'.repeat(MAX_FANJIAO_BODY) })).status).toBe(413);
        await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 2 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
            INSERT INTO fanjiao_records (key, epoch_key, order_key, value_json)
            SELECT 'online:fanjiao:' || n, ?, ?, json_set(?, '$.key', 'online:fanjiao:' || n) FROM numbers`)
            .bind(MAX_FANJIAO_RECORDS, versionKey(ZERO_VERSION), recordOrder(row(1)), recordPayload(row(1))).run();
        const updated = { ...row(2), value: { ...value, position: 10 } };
        expect((await put({ epoch: ZERO_VERSION, records: [updated, { ...row(3), key: 'online:fanjiao:overflow' }] })).status).toBe(409);
        const existing = await db.prepare('SELECT value_json FROM fanjiao_records WHERE key = ?').bind(key).first<{ value_json: string }>();
        expect(JSON.parse(existing!.value_json).value.position).toBe(627);
        expect((await put({ epoch: ZERO_VERSION, records: [updated] })).status).toBe(200);
        expect((await put({ epoch: { counter: 10, device: 'a' }, records: [] })).status).toBe(200);
        expect((await read()).records).toEqual([]);
    });
});

it('syncs two isolated clients through HTTP, including paging, offline deletion, replay and independent preference sync', async () => {
    server = createServer(async (incoming, outgoing) => {
        const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const response = await app.fetch(new Request(`http://localhost${incoming.url}`, { method: incoming.method, headers,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env());
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const config = { provider: 'sync-server' as const, enabled: true, workerBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, authToken: 'fixture-token' };
    const client = () => {
        const entries = new Map<string, string>();
        return new FanjiaoLocalState({ getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); } }, crypto.randomUUID(), {}, true);
    };
    const a = client(), b = client();
    const sync = async (state: FanjiaoLocalState, history = true, preference = false) => state.merge(await exchangeFanjiaoData({ ...config }, state.export(history, preference), () => {}));
    a.save(key, value); b.save('online:fanjiao:2', value);
    for (let n = 3; n <= MAX_FANJIAO_BATCH + 3; n++) a.save(`online:fanjiao:${n}`, value);
    await sync(a); await sync(b); await sync(a);
    expect(a.history).toEqual(b.history);
    expect(b.history.records.find(row => row.key === key)?.value?.position).toBe(627);
    a.reset(key, null); await sync(a);
    b.save(key, { ...value, position: 900 }); await sync(b);
    expect(b.history.records.find(row => row.key === key)?.deleted).toBe(true);
    b.reset(key, { ...value, position: 0 }); await sync(b); await sync(a);
    expect(a.history.records.find(row => row.key === key)?.value?.position).toBe(0);
    a.setPreference(false); await sync(a, false, true); await sync(b, false, true);
    expect(b.preference?.mainOnly).toBe(false);
    a.clear(); await sync(a);
    b.save('online:fanjiao:2', { ...value, position: 800 }); await sync(b);
    expect(b.history.records).toEqual([]);
});
