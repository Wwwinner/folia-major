# 饭角单集播放验证

<!-- 当前目录是独立手动验证工具，不是已经注册到 Folia 的正式 provider。 -->

固定样本：专辑「冬日花火」`111726`，分集「沈楝 早安铃声 5K追剧福利」`120361`。这是用户 HAR 中有实际完整分片请求的零价格、公开福利样本；启动时仍核对样本 ID、专辑、价格、公开标志和时长，变化则停止。

## 已完成

2026-09-14，使用原生 Node.js 和本机 Chrome 验证：

- 从实时 `audio/info` 获取当前播放信息，经 VOD 解析 FD 音源；不依赖 HAR 中的过期播放地址。
- 返回 AAC/HLS，5 个 TS 分片，清单总时长 47.061334 秒。
- 分片按播放需要下载、处理和缓存；跳到 30 秒时可以跳过尚不需要的中间分片。
- 浏览器实际解码得到非零音频信号；暂停时播放时间保持不变。
- 从头正常播放，最终触发 `ended`，播放时间和 duration 均为 47.061333 秒。
- 14 条句级字幕转换成 Folia `LyricData` 形状；30 秒时两条重叠字幕同时匹配。
- 模拟本地授权时间到期后，重新取得授权和地址，保留位置并继续播放。
- 4 个离线测试通过：并发准备共享授权、到期刷新、持续 403 最多刷新一次且不缓存失败、毫秒与重叠字幕边界。

真实云端地址到期没有等待 50 分钟验证。浏览器测试主动令本地截止时间过期；远端 403 的处理由离线 mock 覆盖。页面未接入账户、购买或听歌历史上报。

## 启动

先安装项目依赖，使用 Node.js 24+。在仓库根目录执行：

```powershell
node test/manual/fanjiao/playback/server.mjs --secret-file 'D:/ZZZode/backup/fanjiao-local3/.secret'
```

也可提供环境变量 `FANJIAO_SIGNATURE_SECRET` 并省略 `--secret-file`。不需要 Python、SDK、HAR、FFmpeg 或用户登录态作为运行时依赖。当前验证复用项目已安装的 `hls.js`；正式集成时应将所选播放依赖显式列入项目依赖。

默认打开 [本地验证页](http://127.0.0.1:3411)。`--port 0` 可让系统分配空闲端口；实际地址写入 `test-results/fanjiao-playback/server.json`。服务只监听 loopback。

页面可播放、暂停、跳到 30 秒，并通过“验证地址刷新”模拟本地地址过期。该按钮暂停当前播放、重新获取地址、恢复原位置；页面也展示字幕时间轴和分片处理状态。

## 验证

```powershell
node --test test/manual/fanjiao/playback/session.test.mjs
node test/manual/fanjiao/playback/verify.mjs
```

浏览器验证默认使用 `C:/Program Files/Google/Chrome/Application/chrome.exe`，以新的临时档案、headless 模式运行，不使用用户浏览器资料。可用 `FANJIAO_PROBE_CHROME` 覆盖路径，`FANJIAO_PROBE_ORIGIN` 覆盖服务地址。

结果在已忽略的 `test-results/fanjiao-playback/`：

- `resolution.json`：单集和可用音质元数据，无密钥及上游播放 URL。
- `browser-verification.json`：解码信号、暂停漂移、seek/字幕、刷新和完整播放结果。
- `preview.png`：30 秒处的播放器与字幕截图。
- `server.json`：本地地址和服务 PID。

`playbackStartedMs` 的测量终点是播放头超过 1.5 秒，包含这段播放时间，不能当作纯首声延迟。

## 模块边界

```text
原生 API / VOD 会话 → Node 按需处理 TS → 本地 HLS 地址
                                           ↓
                            hls.js / MediaSource → 原生 audio
标准化字幕 LyricData ───────────────────────→ 字幕时间轴
```

- `../nativeClient.mjs`：只读饭角请求和签名。
- `vod.mjs`、`vodCrypto.mjs`：当前播放会话；临时凭据和媒体密钥只留在 Node 进程内。
- `transportStream.mjs`：保留 TS/PES 头、时间戳，处理媒体载荷。
- `session.mjs`：会话准备、按需取片、并发去重、缓存与一次刷新重试。
- `subtitles.mjs`：字幕时间单位和 `Line` 归一化，保留重叠。
- `server.mjs`：固定路由的本地验证服务；浏览器拿不到上游签名或密钥。
- `preview.*`、`verify.mjs`：手动预览及真实浏览器验证。

## 下一阶段

这是已验证的单集原型，尚未注册正式音源。接入 Folia 时需要：

1. 将协议、媒体会话和缓存放入 Electron 服务，实现生命周期管理；正式高负载媒体处理再评估 Worker。
2. 通过 provider adapter 和 Omni 接入专辑/分集/字幕与播放身份。
3. 为现有音频节点接入 HLS/MSE 生命周期，或提供兼容的媒体表示；仅返回 `.m3u8` 给当前普通 `<audio src>` 并不等于完成适配。
4. 扩展权限与错误模型，单独验证其他分集、账号内容、音质切换、长音频和断网恢复。

该福利样本在 `user_has_eligibility=false` 时仍能通过正常返回的媒体会话完整播放，说明这个字段不能无条件映射为“所有分集不可播放”。本次没有据此推导付费内容的访问规则。
