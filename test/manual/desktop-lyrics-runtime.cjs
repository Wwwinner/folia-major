const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// 使用真实主进程和可信 preload IPC；合成字幕不涉及账户、媒体或用户播放记录。
const root = process.cwd(), output = path.join(root, 'test-results/desktop-lyrics-electron');
const profile = path.resolve(process.argv.find(arg => arg.startsWith('--profile=')).slice(10));
const phase = Number(process.argv.find(arg => arg.startsWith('--phase=')).slice(8));
assert.ok(profile.startsWith(output + path.sep));
app.setPath('userData', profile);
app.getAppPath = () => root;
app.getVersion = () => require(path.join(root, 'package.json')).version;
const report = value => console.log('[Desktop lyrics test] ' + JSON.stringify({ phase, ...value }));
const fail = error => { report({ error: String(error.stack || error) }); app.exit(1); };
process.on('uncaughtExceptionMonitor', fail);
const timeout = setTimeout(() => fail(new Error('Desktop verification timed out')), 60000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, message) {
    for (let i = 0; i < 200; i++) { const value = await read(); if (value) return value; await delay(150); }
    throw new Error(message);
}
app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', (_event, details) => report({ rendererExit: details }));
    contents.on('did-fail-load', (_event, code, description) => report({ loadError: { code, description } }));
});
require(path.join(root, 'electron/main.cjs'));
app.whenReady().then(async () => {
    const main = await until(() => BrowserWindow.getAllWindows().find(win => /^http:\/\/localhost:3000\/($|\?)/.test(win.webContents.getURL())
        && !win.webContents.isLoadingMainFrame()), 'Main window unavailable');
    const execute = script => main.webContents.executeJavaScript(script, true);
    const update = patch => execute(`window.electron.updateDesktopLyrics(${JSON.stringify(patch)})`);
    const read = () => execute('window.electron.getDesktopLyricsState()');
    const mainState = () => ({ bounds: main.getBounds(), top: main.isAlwaysOnTop(), background: main.getBackgroundColor() });
    const baseline = mainState();
    if (phase === 1) await update({ enabled: true });
    const captions = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('desktop-lyrics.html')
        && !win.webContents.isLoadingMainFrame()), 'Subtitle window unavailable');
    const inspect = script => captions.webContents.executeJavaScript(script, true);
    await until(() => inspect('!!document.querySelector("[data-testid=desktop-lyrics-window]")'), 'Subtitle UI unavailable');
    if (phase === 2) {
        const state = await read(), bounds = captions.getBounds();
        assert.deepEqual(state, { enabled: true, locked: true, fontSize: 44, glowIntensity: 0.5 });
        assert.deepEqual(bounds, { x: 120, y: 100, width: 680, height: 260 });
        await update({ locked: false, resetPosition: true });
        assert.equal(captions.isFocusable(), true);
        assert.equal(captions.isResizable(), true);
        await update({ enabled: false });
        assert.equal((await read()).enabled, false);
        report({ restored: { ...state, bounds }, unlockedAndClosedFromMain: true });
    } else {
        assert.deepEqual(mainState(), baseline);
        const current = { hasTrack: true, trackKey: 'fixture-episode', currentTime: 12, duration: 30,
            playerState: 'paused', playbackRate: 1, isAdvancing: false, lyricOffsetMs: 0,
            lyrics: { lines: [
                { startTime: 0, endTime: 20, fullText: '林：先听我说完，这句话还没有结束。', words: [] },
                { startTime: 10, endTime: 15, fullText: '许：我在听，你慢慢说。', words: [] },
                { startTime: 22, endTime: 25, fullText: '未来字幕不应该出现。', words: [] },
            ] } };
        const publish = async value => {
            main.webContents.send('playback-sync-bridge-status-changed', { remoteControlOpen: false,
                desktopLyricsOpen: false, discordPresenceEnabled: false });
            await delay(150);
            await execute(`window.electron.publishRemoteControlSnapshot(${JSON.stringify({ ...value, updatedAt: Date.now() })})`);
        };
        const count = () => inspect('document.querySelectorAll("[data-testid=desktop-subtitle]").length');
        await publish(current);
        await until(async () => await count() === 2, 'Overlapping subtitles absent');
        assert.equal(await inspect('document.querySelectorAll("audio,img,canvas").length'), 0);
        assert.equal(await inspect('typeof window.electron'), 'undefined');
        await update({ locked: true }); await publish(current);
        await until(() => inspect('!!document.querySelector(".is-locked") && !document.querySelector("button")'), 'Lock not reflected');
        assert.equal(captions.isFocusable(), false); assert.equal(captions.isResizable(), false);
        assert.equal(captions.isAlwaysOnTop(), true);
        for (const width of [760, 390]) {
            captions.setBounds({ x: 120, y: 100, width, height: 340 }); await delay(350);
            assert.equal(await inspect('document.documentElement.scrollWidth <= innerWidth'), true);
            fs.writeFileSync(path.join(output, `captions-${width}.png`), (await captions.webContents.capturePage()).toPNG());
        }
        await publish({ ...current, currentTime: 15 });
        await until(async () => await count() === 1, 'Ended subtitle remained');
        await publish({ ...current, currentTime: 4 });
        assert.equal(await inspect('document.body.textContent.includes("许：")'), false);
        await publish({ ...current, currentTime: 3, trackKey: 'next-fixture', lyrics: { lines: [
            { startTime: 0, endTime: 10, fullText: '新一集的字幕。', words: [] },
        ] } });
        await until(() => inspect('document.body.textContent.includes("新一集的字幕。")'), 'Track change not reflected');
        assert.equal(await inspect('document.body.textContent.includes("林：")'), false);
        await update({ fontSize: 44, glowIntensity: 0.5 });
        captions.setBounds({ x: 120, y: 100, width: 680, height: 260 }); await delay(350);
        assert.deepEqual(mainState(), baseline);
        main.hide(); assert.equal(captions.isVisible(), true);
        report({ mainUnchanged: true, mainHideKeepsCaptions: true, narrowPreload: true,
            overlapAndRewind: true, trackChange: true, locked: true, transparent: captions.getBackgroundColor() });
    }
    clearTimeout(timeout); app.quit();
}).catch(fail);
