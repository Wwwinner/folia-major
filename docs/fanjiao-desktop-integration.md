# 饭角桌面接入

<!-- 当前文件记录正式 Electron / Omni 接入的运行方式与验证范围。 -->

2026-09-14：饭角已接入 Folia 的专辑搜索、分集目录、播放队列和歌词页。使用原生 Node.js 实现，不需要 Python、HAR 或数美 SDK。

## 启动与使用

```sh
npm run dev:electron
```

在首页右下的平台切换器选择「饭角」，搜索剧名并打开专辑，通过分集卡片或「查看曲目」列表播放。可用「冬日花火」的「沈楝 早安铃声 5K追剧福利」验证。

### 逐集进度与正片连续播放

- 播放底栏新增正片跳转图标按钮，仅广播剧显示；开启时高亮，悬停显示说明。分集列表和专辑面板不再显示文字开关。
- 队列始终保留全部分集。正片模式依据 `is_positive=1`（包括小剧场），立即影响上一集、下一集和自动续播的目标，跳过附加内容；关闭后按完整队列逐集跳转。按钮标题、下一集预览和预取使用同一选择规则。手动点播花絮、预告或福利音始终允许，不会删改队列。
- 分集分别记住位置；暂停、跳转、切集和正常退出时立即保存，播放期间每 5 秒保存一次。重新进入未听完的分集会继续播放；实际触发结束事件后标记已听完，再次播放从头开始。
- 分集列表保留接口原顺序，不显示分类和总时长。单集播放量来自接口的 `play` 字段，以向右小三角加数字显示，千用 `k`、万用 `w`（最多一位小数）；缺失时显示「—」。有收听记录时显示「已播放 mm:ss」并提供「从头播放」按钮；专辑信息面板提供最近未听完分集的「继续收听」入口。命令面板也可切换正片跳转、从头播放本集。
- 分集行不再显示「加入播放队列」。面板右上角可切换单列／双列；双列按原顺序一行两集，面板从 320px 平滑展开至 480px（1.5 倍），窄窗口受可用宽度限制。切换保留阅读位置，减少动态效果时直接切换宽度。单双列格子均为 76px，长标题单行省略，播放信息优先同行，窄格内可换行；最后一行允许只有一集。
- 进度按 provider 与分集 ID 区分，当前保存在本机，尚未跨设备同步。记录上限为最近 2000 集；异常断电可能丢失最后约 5 秒。

签名凭据只由 Electron 主进程读取，按顺序选择：

1. 环境变量 `FANJIAO_SIGNATURE_SECRET`。
2. 环境变量 `FANJIAO_SIGNATURE_SECRET_FILE` 指定的本机文件。
3. 开发环境项目根目录的 `.fanjiao.secret`；发行环境 Electron `userData` 目录中的同名文件。

本机开发凭据已准备好。`.fanjiao.secret` 和原始 HAR 均被 Git 忽略；凭据不会进入 renderer、打包源码或示例配置。

## 调用与资源边界

```text
Folia 搜索 / 专辑 / 播放队列
  → Omni
  → fanjiaoProvider
  → Electron IPC
  → 原生饭角目录与媒体服务

现有音频节点 + hls.js
  → folia-hls://fanjiao/<集 ID>/<会话 ID>/index.m3u8
  → Electron 按需获取、处理并返回分片
```

目录 IPC 只返回白名单 DTO。签名 secret、PlayAuth、临时媒体密钥和上游播放地址保留在主进程。IPC 同时验证主窗口、主 frame 及应用页面来源。

搜索返回专辑，分集才具有 `online:fanjiao:<audio_id>` 播放身份。字幕直接转换成句级 `LyricData`，保留结束时间和重叠行；饭角禁用自动跨音乐平台匹配替代歌词。

播放器把本地清单地址与 MSE blob 分开识别，切源时销毁旧 HLS 实例。饭角采用按集顺序播放，不参与音乐混音、整曲分析或整曲音频缓存。封面缓存仍可复用。

媒体按分片流式加载，每片仍是完整取得后再处理。每个会话最多缓存 8 MiB，最多保留 8 个会话；2 小时未访问的会话由定时清理释放，退出时全部销毁。授权临近本地时限会刷新，分片返回 401/403 时最多刷新重试一次。

## 当前范围

- 支持匿名专辑搜索、详情和分集列表；暂未接入饭角账号、已购内容、收藏或购买。
- 不再用 `is_public`、价格或 `user_has_eligibility` 单独推断可播性。详情返回媒体授权后，实际请求 VOD 和媒体资源；授权缺失、服务端拒绝和网络错误各自保留失败结果，不能转换成“已下架”。授权字符串存在本身不代表媒体请求一定成功。
- 当前 AAC 的 FD 映射为 standard，HQ 映射为 high；用户偏好 lossless/hires 时也不将 AAC 标为无损。
- 分集接口目前返回整份列表，Omni 在本地分页；没有独立总量字段可证明任意大型专辑的完整性。

## 验证

本次类型检查、81 项相关单测及桌面操作验证通过。福利分集 `120361` 显示 14 条字幕，暂停漂移为 0，30 秒处保留两条重叠字幕；上下集、自然结束续集和 HLS 切回普通 WAV 均已验证。

后续第二集回归：移除 `is_public=0` 的本地阻断，分集 `120484` 通过实际 VOD / HLS 请求与 Folia 界面点播。媒体时长 2281.728 秒，231 个分片，641 条字幕；实际音频输出、暂停续播和跳转至 1200 秒均通过。没有等待整集连续播放结束。此次修复的 28 项相关单测和类型检查通过。

逐集进度首轮回归：70 项相关单测、类型检查及桌面操作通过。第一集保存 90.109 秒、小剧场保存 44.108 秒；重新加载后第一集恢复到 90.128 秒。自然结束进入小剧场，已完成集再次点播从头开始，手动「从头播放」返回零点。报告和截图位于 `test-results/fanjiao-desktop-progress/`。验证使用独立用户配置目录。

正片导航更新回归：53 项相关单测与类型检查通过。真实桌面验证确认队列在切换前后始终为完整 18 集；第一集的下一集在开启时为小剧场、关闭时为花絮，上一集和自然结束使用同一跳转规则。1100px 与 390px 窗口的图标按钮已检查，报告及截图位于 `test-results/fanjiao-desktop-navigation/`。旧版本已经裁剪的队列无法凭本地记录还原，重新从专辑点播即可建立完整队列。

`test/manual/fanjiao/desktop-verify.mjs` 在独立配置目录运行真实 Folia Electron 窗口。验证使用真实服务和正式 UI；报告、截图及测试配置目录写入已忽略的 `test-results/fanjiao-desktop/`。

覆盖搜索、专辑与分集、MSE 播放、音频输出、句级字幕、暂停/续播、跳转 30 秒、受控错误后的重新取源、上下集和自然结束后的自动续集。播放源恢复测试主动派发与 HLS fatal 相同的媒体错误事件；没有等待云端授权自然过期。403 重试和本地时间到期另由离线单测覆盖。

```sh
node test/manual/fanjiao/desktop-verify.mjs
node test/manual/fanjiao/desktop-verify.mjs --episode-two
node test/manual/fanjiao/desktop-verify.mjs --episode-progress
node test/manual/fanjiao/desktop-verify.mjs --episode-navigation
npm run typecheck
npm run test:unit -- test/unit/electron/fanjiao.test.ts test/unit/onlineMusic/fanjiaoProvider.test.ts test/unit/playback/onlineRecoveryController.test.ts test/unit/playback/playedTrackCache.test.ts
```

运行桌面验证前需先启动 Vite，且 `http://localhost:3000` 可访问。早期固定分集的独立验证服务仍位于 `test/manual/fanjiao/playback/`，正式接入不依赖它。
