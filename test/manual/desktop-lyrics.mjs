import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 隔离用户配置，分两次启动真实 Electron 验证字幕窗口及重启恢复。
const root = process.cwd(), output = path.join(root, 'test-results/desktop-lyrics-electron');
const profile = path.join(output, `profile-${process.pid}`), reports = [];
const env = { ...process.env, ELECTRON_DEV: 'true' };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(output, { recursive: true });
for (const phase of [1, 2]) {
    await new Promise((resolve, reject) => {
        // 当前自动化宿主无法启动 Chromium 沙箱子进程；这些参数仅属于隔离测试，不进入应用启动配置。
        const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'),
            ['--in-process-gpu', '--no-sandbox', 'test/manual/desktop-lyrics-runtime.cjs', `--phase=${phase}`, `--profile=${profile}`],
            { cwd: root, env, windowsHide: true });
        let pending = '', errors = '';
        child.stdout.on('data', data => {
            pending += data.toString();
            const lines = pending.split('\n'); pending = lines.pop();
            for (const line of lines) {
                const prefix = '[Desktop lyrics test] ';
                if (!line.startsWith(prefix)) continue;
                const report = JSON.parse(line.slice(prefix.length));
                reports.push(report); console.log(JSON.stringify(report));
            }
        });
        child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4000); });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Electron phase ${phase} exited ${code}\n${errors}`)));
    });
}
await writeFile(path.join(output, 'verification.json'), JSON.stringify(reports, null, 2));
