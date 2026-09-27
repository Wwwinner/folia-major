import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { MAX_FANJIAO_BATCH, MAX_FANJIAO_BODY, isFanjiaoKey, parseFanjiaoSyncData } from '../../shared/fanjiaoSync.mjs';
import { ensureFanjiaoSchema, readFanjiaoHistory, readFanjiaoPreference, writeFanjiaoHistory, writeFanjiaoPreference } from './fanjiaoStorage.js';
import type { Env } from './app.js';

// Mounted after bearer authentication. Category routes never read or write the other opt-in category.
const routes = new Hono<{ Bindings: Env }>();
routes.use('*', bodyLimit({ maxSize: MAX_FANJIAO_BODY, onError: c => c.json({ error: 'fanjiao_too_large' }, 413) }));
routes.use('*', async (c, next) => { await ensureFanjiaoSchema(c.env.FOLIA_SYNC_DB); await next(); });
routes.get('/history', async c => {
    const cursor = c.req.query('cursor') || '';
    if (cursor && !isFanjiaoKey(cursor)) return c.json({ error: 'invalid_fanjiao_cursor' }, 400);
    return c.json(await readFanjiaoHistory(c.env.FOLIA_SYNC_DB, cursor, MAX_FANJIAO_BATCH));
});
routes.post('/history', async c => {
    const parsed = parseFanjiaoSyncData(await c.req.json().catch(() => null));
    if (!parsed?.history || parsed.preference !== undefined) return c.json({ error: 'invalid_fanjiao_history' }, 400);
    try { await writeFanjiaoHistory(c.env.FOLIA_SYNC_DB, parsed.history); }
    catch (error) {
        if (String(error).includes('fanjiao_capacity')) return c.json({ error: 'fanjiao_capacity' }, 409);
        throw error;
    }
    return c.json({ ok: true, protocol: 1 });
});
routes.get('/preference', async c => c.json({ protocol: 1, preference: await readFanjiaoPreference(c.env.FOLIA_SYNC_DB) }));
routes.put('/preference', async c => {
    const parsed = parseFanjiaoSyncData(await c.req.json().catch(() => null));
    if (!parsed?.preference || parsed.history !== undefined) return c.json({ error: 'invalid_fanjiao_preference' }, 400);
    await writeFanjiaoPreference(c.env.FOLIA_SYNC_DB, parsed.preference);
    return c.json({ ok: true, protocol: 1 });
});
export default routes;
