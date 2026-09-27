import { MAX_FANJIAO_RECORDS, ZERO_VERSION, recordOrder, recordPayload, versionKey } from '../../shared/fanjiaoSync.mjs';
import type { FanjiaoHistory, FanjiaoPreference, FanjiaoRecord, SyncVersion } from '../../shared/fanjiaoSync.mjs';
import type { D1Database } from './app.js';

// Independent tables keep legacy settings uploads from overwriting listening data.
const migrations = new WeakMap<D1Database, Promise<void>>();
export function ensureFanjiaoSchema(db: D1Database) {
    let pending = migrations.get(db);
    if (!pending) {
        pending = db.batch([
            db.prepare('CREATE TABLE IF NOT EXISTS fanjiao_meta (key TEXT PRIMARY KEY, order_key TEXT NOT NULL, value_json TEXT NOT NULL)'),
            db.prepare('CREATE TABLE IF NOT EXISTS fanjiao_records (key TEXT PRIMARY KEY, epoch_key TEXT NOT NULL, order_key TEXT NOT NULL, value_json TEXT NOT NULL)'),
            db.prepare(`CREATE TRIGGER IF NOT EXISTS fanjiao_capacity BEFORE INSERT ON fanjiao_records
                WHEN NOT EXISTS (SELECT 1 FROM fanjiao_records WHERE key = NEW.key)
                    AND (SELECT COUNT(*) FROM fanjiao_records) >= ${MAX_FANJIAO_RECORDS}
                BEGIN SELECT RAISE(ABORT, 'fanjiao_capacity'); END`),
            db.prepare('INSERT OR IGNORE INTO fanjiao_meta (key, order_key, value_json) VALUES (?, ?, ?)')
                .bind('epoch', versionKey(ZERO_VERSION), JSON.stringify(ZERO_VERSION)),
        ]).then(() => undefined).catch(error => { migrations.delete(db); throw error; });
        migrations.set(db, pending);
    }
    return pending;
}

export async function readFanjiaoHistory(db: D1Database, cursor: string, limit: number) {
    // One SQL snapshot returns the epoch and page together, including an empty page after clear.
    const rows = await db.prepare(`SELECT m.value_json AS epoch_json, r.key, r.value_json
        FROM fanjiao_meta m LEFT JOIN
            (SELECT key, value_json, epoch_key FROM fanjiao_records WHERE key > ? ORDER BY key LIMIT ?) r
            ON r.epoch_key = m.order_key WHERE m.key = 'epoch' ORDER BY r.key`)
        .bind(cursor, limit).all<{ epoch_json: string; key: string | null; value_json: string | null }>();
    const entries = rows.results ?? [];
    const epoch: SyncVersion = entries.length ? JSON.parse(entries[0].epoch_json) : ZERO_VERSION;
    const records: FanjiaoRecord[] = entries.flatMap(row => row.value_json ? [JSON.parse(row.value_json)] : []);
    return { protocol: 1, history: { epoch, records }, cursor: records.length === limit ? records.at(-1)!.key : null };
}

// D1 batch and SQLite transactions atomically advance the clear fence and compare each incoming row in SQL.
export async function writeFanjiaoHistory(db: D1Database, history: FanjiaoHistory) {
    const epoch = versionKey(history.epoch);
    const rows = history.records.map(row => ({ key: row.key, epoch, order: recordOrder(row), payload: recordPayload(row) }));
    await db.batch([
        db.prepare(`INSERT INTO fanjiao_meta (key, order_key, value_json) VALUES ('epoch', ?, ?)
            ON CONFLICT(key) DO UPDATE SET order_key = excluded.order_key, value_json = excluded.value_json
            WHERE excluded.order_key > fanjiao_meta.order_key`).bind(epoch, JSON.stringify(history.epoch)),
        db.prepare("DELETE FROM fanjiao_records WHERE epoch_key < (SELECT order_key FROM fanjiao_meta WHERE key = 'epoch')"),
        db.prepare(`INSERT INTO fanjiao_records (key, epoch_key, order_key, value_json)
            SELECT json_extract(value, '$.key'), json_extract(value, '$.epoch'), json_extract(value, '$.order'), json_extract(value, '$.payload')
            FROM json_each(?) WHERE json_extract(value, '$.epoch') = (SELECT order_key FROM fanjiao_meta WHERE key = 'epoch')
            ON CONFLICT(key) DO UPDATE SET epoch_key = excluded.epoch_key, order_key = excluded.order_key, value_json = excluded.value_json
            WHERE excluded.order_key > fanjiao_records.order_key
                OR (excluded.order_key = fanjiao_records.order_key AND excluded.value_json > fanjiao_records.value_json)`)
            .bind(JSON.stringify(rows)),
    ]);
}

export async function readFanjiaoPreference(db: D1Database): Promise<FanjiaoPreference | null> {
    const row = await db.prepare("SELECT value_json FROM fanjiao_meta WHERE key = 'preference'").first<{ value_json: string }>();
    return row ? JSON.parse(row.value_json) : null;
}

export async function writeFanjiaoPreference(db: D1Database, preference: FanjiaoPreference) {
    await db.prepare(`INSERT INTO fanjiao_meta (key, order_key, value_json) VALUES ('preference', ?, ?)
        ON CONFLICT(key) DO UPDATE SET order_key = excluded.order_key, value_json = excluded.value_json
        WHERE excluded.order_key > fanjiao_meta.order_key
            OR (excluded.order_key = fanjiao_meta.order_key AND excluded.value_json > fanjiao_meta.value_json)`)
        .bind(versionKey(preference.version), JSON.stringify(preference)).run();
}
