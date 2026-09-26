const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// 原生 Electron 回归入口：真实主进程、preload IPC 和 Chromium 代理，使用隔离配置。
const root = process.cwd();
const output = path.join(root, 'test-results/proxy-settings-electron');
const profile = path.resolve(process.argv.find(arg => arg.startsWith('--profile=')).slice(10));
const phase = Number(process.argv.find(arg => arg.startsWith('--phase=')).slice(8));
assert.ok(profile.startsWith(output + path.sep));
app.setPath('userData', profile);
app.getAppPath = () => root;
app.getVersion = () => require(path.join(root, 'package.json')).version;
const report = value => console.log('[Proxy settings test] ' + JSON.stringify(value));
const fail = error => {
    report({ phase, error: String(error.message || error).replace(/https?:\/\/\S+/g, '[URL]') });
    app.exit(1);
};
process.on('uncaughtExceptionMonitor', fail);
const timeout = setTimeout(() => fail(new Error('Desktop verification timed out')), 60000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
require(path.join(root, 'electron/main.cjs'));
app.whenReady().then(async () => {
    let win;
    for (let i = 0; i < 150; i++) {
        win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('http://localhost:3000/')
            && !item.webContents.isLoadingMainFrame());
        if (win) break;
        await delay(200);
    }
    assert.ok(win, 'Main window unavailable');
    const execute = script => win.webContents.executeJavaScript(script, true);
    const read = () => execute(`window.electron.getSettings().then(s => ({config:s.NETWORK_PROXY,
        supported:s.NETWORK_PROXY_SUPPORTED,restartRequired:s.NETWORK_PROXY_RESTART_REQUIRED}))`);
    const initial = await read();
    const route = await session.defaultSession.resolveProxy('https://play-offline.fanjiao.co');
    assert.equal(initial.supported, true);
    assert.equal(initial.restartRequired, false);
    if (phase === 1) {
        assert.equal(initial.config.mode, 'custom');
        assert.match(route, /PROXY 127\.0\.0\.1:7897/);
        await execute(`(async () => {
            for (const button of document.querySelectorAll('button')) {
                if (/^(我知道了|就这样|Got it|Let's go)$/i.test(button.textContent.trim())) button.click();
            }
            const state = (await import('/src/stores/useSettingsModalStore.ts')).useSettingsModalStore.getState();
            state.setIsUserGuideModalOpen(false);
            state.openSettings('options','desktop',null,'proxySettings');
        })()`);
        const selector = '[data-settings-anchor="proxySettings"] input';
        let address;
        for (let i = 0; i < 40; i++) {
            address = await execute(`document.querySelector('${selector}')?.value`);
            if (address) break;
            await delay(100);
        }
        assert.equal(address, 'http://127.0.0.1:7897');
        win.setSize(1100, 800);
        await delay(500);
        for (let i = 0; i < 4; i++) {
            await execute(`document.querySelectorAll('button').forEach(button => {
                if (/^(我知道了|就这样|Got it|Let's go)$/i.test(button.textContent.trim())) button.click();
            })`);
            await delay(250);
        }
        await execute(`document.querySelector('${selector}').closest('[data-settings-anchor]').scrollIntoView({block:'center'})`);
        await delay(500);
        fs.writeFileSync(path.join(output, 'settings.png'), (await win.webContents.capturePage()).toPNG());
        await execute(`window.electron.saveSettings('NETWORK_PROXY',{mode:'direct',address:''})`);
        assert.equal((await read()).restartRequired, true);
        assert.equal(await session.defaultSession.resolveProxy('https://play-offline.fanjiao.co'), route);
    } else if (phase === 2) {
        assert.equal(initial.config.mode, 'direct');
        assert.equal(route, 'DIRECT');
        const rejected = await execute(`window.electron.saveSettings('NETWORK_PROXY',
            {mode:'custom',address:'http://user:secret@localhost:1'}).then(() => false, () => true)`);
        assert.equal(rejected, true);
        assert.equal((await read()).config.mode, 'direct');
        await execute(`window.electron.saveSettings('NETWORK_PROXY',{mode:'system',address:''})`);
    } else {
        assert.equal(initial.config.mode, 'system');
    }
    report({ phase, initial, route });
    clearTimeout(timeout);
    app.quit();
}).catch(fail);
