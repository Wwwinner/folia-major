import assert from 'node:assert/strict';
import { ZERO_VERSION } from '../../shared/fanjiaoSync.mjs';

// Run only against a disposable, empty localhost Node or wrangler --local sync database.
const base = new URL(process.argv[2] || 'http://127.0.0.1:18787');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only disposable localhost services are allowed');
const token = process.env.FANJIAO_TEST_TOKEN || 'local-test-token';
async function request(path, data, method = data ? 'POST' : 'GET') {
    const response = await fetch(new URL(path, base), { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, `${method} ${path}: ${await response.clone().text()}`);
    return response.json();
}
assert.equal((await request('/health')).capabilities.fanjiaoSync, 1);
const initial = await request('/fanjiao/history');
assert.deepEqual(initial.history, { epoch: ZERO_VERSION, records: [] }, 'Use an empty temporary test database');
assert.equal((await request('/fanjiao/preference')).preference, null, 'Use an empty temporary test database');
const visual = await request('/settings');
const version = counter => ({ counter, device: 'smoke-client' });
const value = { position: 627, duration: 1200, completed: false, updatedAt: 100, lastPlayedAt: 90 };
const record = { key: 'online:fanjiao:smoke', epoch: ZERO_VERSION, generation: ZERO_VERSION, version: version(1), deleted: false, value };
const write = (records, epoch = ZERO_VERSION) => request('/fanjiao/history', { protocol: 1, history: { epoch, records } });
await Promise.all([write([record]), write([{ ...record, key: 'online:fanjiao:other' }])]);
assert.equal((await request('/fanjiao/history')).history.records.length, 2);
const restarted = { ...record, generation: version(2), version: version(3), value: { ...value, position: 0 } };
await write([restarted]); await write([{ ...record, version: version(999) }]);
assert.equal((await request('/fanjiao/history')).history.records.find(row => row.key === record.key).value.position, 0);
await write([{ ...record, generation: version(4), version: version(4), deleted: true, value: null }]);
await write([record]);
assert.equal((await request('/fanjiao/history')).history.records.find(row => row.key === record.key).deleted, true);
await request('/fanjiao/preference', { protocol: 1, preference: { version: version(5), mainOnly: false } }, 'PUT');
await write([], version(6)); await write([record]);
assert.deepEqual((await request('/fanjiao/history')).history, { epoch: version(6), records: [] });
assert.equal((await request('/fanjiao/preference')).preference.mainOnly, false);
assert.deepEqual(await request('/settings'), visual);
console.log('Fanjiao local smoke passed: concurrent merge, restart, delete, clear, preferences, legacy compatibility.');
