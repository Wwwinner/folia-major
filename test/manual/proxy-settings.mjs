import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 独立用户目录中启动真实 Electron，验证保存及重启，不修改日常使用的设置。
const root = process.cwd();
const output = path.join(root, 'test-results/proxy-settings-electron');
const profile = path.join(output, `profile-${process.pid}`);
const reports = [];
await mkdir(output, { recursive: true });
for (const phase of [1, 2, 3]) {
    await new Promise((resolve, reject) => {
        const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'),
            ['test/manual/proxy-settings-runtime.cjs', `--phase=${phase}`, `--profile=${profile}`],
            { cwd: root, env: { ...process.env, ELECTRON_DEV: 'true' }, windowsHide: true });
        let pending = '';
        child.stdout.on('data', data => {
            pending += data.toString();
            const lines = pending.split('\n');
            pending = lines.pop();
            for (const line of lines) {
                const prefix = '[Proxy settings test] ';
                if (!line.startsWith(prefix)) continue;
                const report = JSON.parse(line.slice(prefix.length));
                reports.push(report);
                console.log(JSON.stringify(report));
            }
        });
        child.stderr.resume();
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Electron phase ${phase} exited ${code}`)));
    });
}
await writeFile(path.join(output, 'verification.json'), JSON.stringify(reports, null, 2));
