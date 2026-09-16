# 饭角单集播放验证结果

<!-- 当前文件是阶段二验收摘要，具体运行方式在手动验证目录的 README 中。 -->

2026-09-14，原生 Node.js 单集播放验证通过。样本为「冬日花火」下的 47 秒公开福利音频，`album_id=111726`、`audio_id=120361`。

| 验证项 | 结果 |
| --- | --- |
| 当前播放地址 | 通过实时 API/VOD 获取，不复用 HAR 地址 |
| 音频 | AAC ADTS，FD HLS，5 个分片 |
| 实际解码 | Web Audio 检测到非零信号，采样峰值 RMS 约 0.126 |
| 暂停 | 700 ms 检查窗口中播放时间漂移为 0 |
| 拖动 | 成功跳至 30 秒并继续播放 |
| 字幕 | 14 条句级字幕，30 秒处两条重叠字幕均与时间轴匹配 |
| 地址刷新 | 模拟本地到期后刷新一次，恢复位置并续播 |
| 完整播放 | 自然触发 ended，结束时间 47.061333 秒 |
| 离线边界测试 | 4 项通过，包含持续拒绝时的重试上限 |

演示服务：[http://127.0.0.1:3411](http://127.0.0.1:3411)。只有本机服务运行时可访问。

详细运行说明、模块划分和测试范围见 [播放验证 README](../test/manual/fanjiao/playback/README.md)。本机浏览器证据为 `test-results/fanjiao-playback/browser-verification.json`，截图为同目录 `preview.png`。

运行时不依赖 Python、HAR 或数美 SDK。以上是独立原型阶段使用本机 Chrome 的验证记录；后续正式 Folia provider、Electron 服务装配和播放器 HLS 适配见 [桌面接入](fanjiao-desktop-integration.md)。

仅验证该固定公开样本；未把 `user_has_eligibility=false`、`price=0` 等字段推广成通用账号或付费资格规则。真实云端地址自然过期未等待验证，本地到期续播为浏览器实测，持续 403 处理为离线测试。
