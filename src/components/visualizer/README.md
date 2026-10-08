# Visualizer 代码地图

Visualizer 是一个由共享 shell/runtime/registry 组合多个歌词渲染模式的目录。新增或修复模式时，先从统一入口定位，不要从 `App.tsx` 复制渲染分支。

## Runtime flow

```text
App / ThemePark / VisPlayground / OBS source
  -> VisualizerRenderer.tsx
       -> applyVisualizerTuning()
       -> backgrounds/registry.tsx（默认背景与背景 entry）
       -> registry.tsx（按 VisualizerMode 找到 <mode>/entry.tsx）
       -> mode renderer
       -> VisualizerHarmonyOverlay
```

共享外壳在 `VisualizerShell.tsx`：透明容器、背景 renderer、字体栈/字重、返回按钮和 player-panel hotspot。底部/翻译字幕通常由 `VisualizerSubtitleOverlay.tsx` 或模式自身按既有契约处理。共享契约在 `definition.ts`，不要在模式组件里重新声明一套歌词 props。

两组字幕字号（译文 / 下一句预览）只有一处来源：`subtitleFontSizes.ts` 的 `resolveSubtitleFontSizes(lyricsFontScale)`。模式间切换时它们不能跳字号，所以别在模式里再抄一份 clamp。

运行时辅助在 `runtime.ts`：

- `useVisualizerRuntime`
- `getRecentCompletedLine`
- `getUpcomingLine` / `getUpcomingLines`
- `shouldPreheatLine`
- `prepareActiveAndUpcoming`

这些函数统一当前行、上一句、下一句和预热窗口；不要在新模式中重新扫描 `lines`。

## Current mode registry

每个模式通过 `src/components/visualizer/<mode>/entry.tsx` 注册，registry 使用 Vite `import.meta.glob('./*/entry.tsx', { eager: true })` 自动发现。当前模式：

| mode | 显示名 | 主要 renderer / 辅助文件 |
| --- | --- | --- |
| `still` | 静止 | `still/VisualizerStill.tsx`（不挂载共享背景层） |
| `classic` | Luminous | `classic/Visualizer.tsx`、`classic/tuning.ts` |
| `cadenza` | Mindscape | `cadenza/VisualizerCadenza.tsx`、`cadenza/tuning.ts` |
| `partita` | 云阶 | `partita/VisualizerPartita.tsx`、`partita/tuning.ts` |
| `fume` | Fume | `fume/VisualizerFume.tsx`、`fume/tuning.ts` |
| `cappella` | Cappella | `cappella/VisualizerCappella.tsx`、`avatarImages.ts`、`emoImages.ts` |
| `tilt` | Tilt | `tilt/VisualizerTilt.tsx`、`tilt/tuning.ts` |
| `claddagh` | Claddagh | `claddagh/VisualizerCladdagh.tsx`、`claddagh/tuning.ts` |
| `monet` | Monet | `monet/VisualizerMonet.tsx`、`monet/monetLyricsModel.ts`、`monet/tuning.ts` |
| `dialogue` | 对白 | `dialogue/VisualizerDialogue.tsx`、`dialogue/dialogueTimeline.ts`；渲染直接复用莫奈 |
| `diorama` | 镜台 | `diorama/VisualizerDiorama.tsx`、`diorama/DioramaScene.tsx`、`diorama/dioramaTextRaster.ts` |
| `pendolo` | Pendolo | `pendolo/VisualizerPendolo.tsx`、`pendolo/pendoloTextLayout.ts`、`pendolo/pendoloTimeline.ts` |
| `sonnet` | 商籁 | `sonnet/VisualizerSonnet.tsx`、`sonnet/createSonnetPixiRuntime.ts`、`sonnet/*` |
| `tempera` | 凝彩 | `tempera/VisualizerTempera.tsx`、`tempera/createTemperaPixiRuntime.ts`、`tempera/*` |
| `lumiere` | 绘光 | `lumiere/VisualizerLumiere.tsx`、`lumiere/createLumierePixiRuntime.ts`、`lumiere/*` |

`registry.tsx` 的默认模式是 `classic`。模式枚举/共享 tuning map 见 `src/types.ts`、`definition.ts`、`tuningRegistry.ts`。

## Background registry

背景 entry 位于 `backgrounds/<name>/entry.tsx`，由 `backgrounds/registry.tsx` 发现；当前实现为：

- `common`：`FluidBackground.tsx`、`GeometricBackground.tsx`，带 `CommonBackgroundSettingsCard.tsx`
- `latent`：`LatentBackground.tsx`、设置卡
- `monet`：`MonetBackgroundLayer.tsx`、设置卡
- `nomand`：`NomandBackgroundLayer.tsx`、设置卡
- `sora`：`SoraBackground.tsx`
- `url`：`UrlBackgroundLayer.tsx`、设置卡

共享背景 props 与默认值在 `backgrounds/definition.ts`；实际渲染在 `backgrounds/VisualizerBackgroundRenderer.tsx`。新增背景不要在每个 visualizer 中内联。

## Shared contracts and helpers

### `definition.ts`

`VisualizerSharedProps` 是模式共同输入，包含 `MotionValue currentTime`、当前行/全部歌词、主题与字幕主题、音频分析值、背景/透明度、字幕显示开关、播放状态、seek/back/panel callbacks、资源和模式 tuning。完整字段以代码为准；本 README 只保留定位信息。

当前 tuning 覆盖 13 个模式，并通过 `VisualizerRenderer` 的 `applyVisualizerTuning` 统一注入。模式级设置面板和 reset 由各自 `entry.tsx` / `tuning.ts` 提供，再由 `settingsPanels.tsx` 和 `VisPlaygroundSettingsPanel.tsx` 复用。

### Lyrics pipeline

Visualizer 消费已解析的 `LyricData` / `Line` / `Word`，不负责解析 `.lrc`、`.vtt`、`.yrc` 或 `.qrc`。

- `src/utils/lyrics/parserCore.ts`：解析真源
- `src/utils/lyrics/renderHints.ts`：`getLineRenderHints`、`getLineRenderEndTime`、短句/快速 reveal
- `src/utils/lyrics/cjkSemanticLayout.ts`：CJK semantic grouping、sticky punctuation、display units
- `src/utils/lyrics/graphemeTiming.ts`：逐 grapheme timing
- `wordColoring.ts`：共享词高亮范围
- `src/utils/fontStacks.ts`：DOM、Canvas、pretext 和光栅化路径统一字重/字体栈
- `colorMix.ts`：主题色 alpha 与混合

`Line.fullText` 用于整句布局，`Line.words` 是 timing 真源；两者不保证简单拼接完全相等。重复词、空格、CJK 和标点不要用字符串搜索重新猜时间范围。

## Mode-specific navigation

### Cadenza / Fume

两者都属于测量和布局敏感模式：实现见 `cadenza/VisualizerCadenza.tsx` 与 `fume/VisualizerFume.tsx`。代码使用 `@chenglou/pretext` 做文字准备/测量；Fume 还维护 article-level layout 与 cache。先查 `src/utils/lyrics/renderHints.ts` 和 `fontStacks.ts`，再改布局。

### Partita

完整的数据流说明见 [`partita/README.md`](partita/README.md)。快速定位：

- `VisualizerPartita.tsx`：sequential layout、缓存、预热、chunk/word 渲染
- `src/utils/lyrics/cjkSemanticLayout.ts`：`buildPostLyricLayoutUnits`、`buildDisplayWordsFromLayoutUnits`
- `src/utils/lyrics/renderHints.ts`：行 transition / word reveal profile
- `PartitaChunk` / `PartitaWord`：行级与 display word 级动画

不要修改 `Line.words`；layout unit 和 display word 只应是 renderer 派生数据。

### Cappella

`cappella/VisualizerCappella.tsx` 负责群唱头像、聊天表情和歌词呈现。内置资源通过 `avatarImages.ts` / `emoImages.ts` 的 glob 载入；用户资源分别由 `src/services/cappellaAvatarPack.ts` 与 `cappellaEmojiPack.ts` 存入 IndexedDB。资源目录说明见 `cappella/avatar/README.md`、`cappella/emo/README.md`。

### Claddagh

`claddagh/VisualizerCladdagh.tsx` 使用 `buildLineGraphemeTimeline`、`pretext` 和有限 ring lines；音频响应/RAF 与 DOM 样式更新必须有界并在 cleanup 中释放。

### Monet

`monet/VisualizerMonet.tsx` 组合 `MonetLyricsRail`、`AudioOverlay`、浮动装饰和背景 pipeline；图像资源还涉及 `src/services/monetBackgroundImage.ts`、`monetPortraitImage.ts`。

### Dialogue

`DialogueMist.tsx` 提前排好未来两句的 waiting 行，但雾只在对应句开始前一秒渐显；到句子开始才挂载文本，不能生成未来文字 DOM、可访问名称或可点击目标。雾宽复用 pretext 输出的 `textContentWidthPx`，围绕对应文字区域在莫奈已有光晕留白内少量扩散，不撑高行或改变文本换行；位置和滚动直接跟随原行，保持行、雾和画布的节点身份，没有独立底部定位、额外入场位移或 LayoutGroup 投影。文字到点开始显现，雾先随行起步再消散；渐显与散雾均由播放 MotionValue 驱动，短句时限由 `dialogueMistMotion.ts` 约束。手动回看只包含已开始行，减少动态效果时关闭雾层。

`DialogueMistTexture.tsx` 以播放时钟更新局部 WebGL 雾纹，每句用稳定序号错开纹理相位。主雾保持紧贴文字，canvas 另加最多 16px 的透明绘制留白，shader 通过 `u_viewScale` 还原主雾坐标。`dialogueMistShader.ts` 累积三层独立缓流的低对比度密度，以自然衰减的软边替代亮丝、恒定底密度和硬性的主体边界；散开时局部漂移并逐渐稀释。文字在雾层上方绘制，保留字面清晰度。`dialogueMistRenderer.ts` 复用 twgl，包含透明留白的绘制分辨率仍不超过 384×128、局部最多 30fps；不在绘制帧中测量布局或更新 React 状态。暂停后没有常驻绘制循环，远期透明、离屏、页面隐藏或散雾结束时停止绘制，卸载时取消订阅并释放资源。演示页「散雾中」定位实际消散中段，「短句前」可检查短句雾的形态。

`dialogueRailEntries.ts` 在自动跟随时把所有未结束句补入莫奈的附近窗口，按时间顺序排列，并以活动组整体定位。空间不足时只收起活动组中间的历史句；手动回看保留原有历史窗口和空闲恢复行为。`dev-probe.html?probe=dialogueOverlap` 可交互查看长句跨越短句、独立结束及回退。

`dialogue/VisualizerDialogue.tsx` 是莫奈的句级适配层，直接调用 `monet/entry.tsx` 的 renderer，共享完整构图、封面、滚动动效和设置面板。`tuningRegistry` 将对白映射到同一个 `monet` 参数存储，字体缩放仍由莫奈入口统一应用。

`dialogueTimeline.ts` 以句级 `startTime/endTime` 建立边界索引，`useDialogueTimeline` 只在句子边界或跳转时更新 React 状态。传给莫奈的是已开始字幕及两行预排版，`sentencePlayback.startedCount` 控制文本挂载边界，活动集合保留重叠高亮；`MonetLyricsRail` 在该分支整句渲染，不挂载逐字扫光/发光组件。回退时直接移除后文，避免退出动画短暂保留未来台词。滚轮和触屏回看使用莫奈原有小窗口及空闲自动跟随，点击跳转也复用同一处理器。

`MonetSentenceText` 以普通文本规则换行，保留硬换行；pretext 提供初始行高，有限可见行的 ResizeObserver 按实际浏览器排版校正缓存，处理中文标点压缩与字体加载差异。回调只在行数改变时更新布局，不在播放帧里测量。整句光晕与逐词光晕共用 `buildMonetGlowShadow` 的半径、混色和强度，整句的亮起/驻留/淡出由播放 MotionValue 驱动，与扫光蒙版解耦。

### Diorama

`diorama/VisualizerDiorama.tsx` 进入 React Three Fiber 场景；场景/粒子/相机/文字光栅化分别看 `DioramaScene.tsx`、`dioramaParticle*.ts`、`cameraPath.ts`、`dioramaTextRaster.ts`。连续场景数据不要提升到 React state。

### Pendolo

`pendolo/VisualizerPendolo.tsx` 是 React 外壳；`PendoloClockworkCanvas.tsx` 负责时钟机械 canvas，`pendoloTextLayout.ts`、`pendoloTimeline.ts`、`pendoloGeometry.ts` 负责有界布局与时间线，`PendoloSettingsPanel.tsx` 负责调参。

### Sonnet

`sonnet/VisualizerSonnet.tsx` 负责 React shell/subtitle，`createSonnetPixiRuntime.ts` 创建 Pixi runtime；其余 `sonnet*` 文件按 scene builder、shot flow、glyph/typography、post-process、resource pool 分工。注意 Pixi runtime、纹理和 RAF 的销毁。

### Tempera

完整说明见 [`tempera/README.md`](tempera/README.md)——编译期分镜、拼贴排版、逐字时序、网点图形语汇、文字反色 filter、渐变调色、片尾卡、画布图片池都在那里。快速定位：

- `tempera/VisualizerTempera.tsx`：React shell / subtitle；`createTemperaPixiRuntime.ts`：Pixi runtime（scene cache ±1、绝对时间驱动）
- `temperaProgram.ts` + `types.ts`：段落 / shot / slice 编译，121 种 shot kind
- `temperaLayout.ts` + `temperaMotion.ts`：拼贴排版与逐字入场求解
- `temperaDifferenceFilter.ts`：文字对背景逐像素反色，改动前务必先读那份说明里的约束
- Tempera 渲染层不消费音频（`audioPower`/`audioBands` 只传给共享背景层）。

### Lumiere

绘光：舞台光式的歌词 PV——体积光束、烟雾、线稿与浮尘组成的「图形组」，歌词按光束明暗点亮。快速定位：

- `lumiere/VisualizerLumiere.tsx`：React shell / subtitle；`createLumierePixiRuntime.ts`：Pixi runtime（WebGL only，建一次、换歌就地交接，scene cache ±1，一帧最多做一件贵的事）
- `lumiereProgram.ts` + `program.ts`：整首编译（段落首尾相接铺满时间轴、镜头、光位、段落转场）；纯音乐编译成只有间奏镜头的程序，不造 ♪ 虚拟行
- `scene.ts` / `lumiereUnit.ts`：一个段落一个场景，运镜在场景内部；运行时只在外面的 holder 上套转场帧（`lumiereSceneFrames.ts`：出场帧 + 边界后的交叉渐变，熄灯的变暗由场景自己的 fadeOut 完成）
- `lumiereSeamless.ts`：轨迹过渡（tuning `seamlessTransitions`，默认开）把按段落编好的程序并成整首一个单元——镜头 / 光位不变，段落之间也走光位交接，运镜按原段落往返推拉；它是编译选项（`LUMIERE_COMPILE_KEYS`），切换时重新编译、经同曲 swapSong 清场景缓存，不重建 WebGL。歌词窗口按需排版（只排当前行前后几行，见 `text/windowLines.ts`），所以整首一个单元建场景约 45–50 ms，与按段落相近；`lumiereUnitLayout.ts` 放领头光位 / 逐行排版 / 运镜这几个由镜头决定的纯函数
- `lumiereRuntimeTuning.ts`：用户 tuning → 场景 tuning、画质档（full / balanced / low 只降图形组 filter 分辨率、封顶烟雾倍频，文字保持满分辨率）、哪些改动要防抖重建场景
- `lumiereAudio.ts`：`audioBands.bass` / `treble` / `audioPower` 归一化到 0..1（主播放器 0..255、预览 0..1）并做起音 / 释放平滑；渲染层消费音频
- `lumiereCreditsLayer.ts` + `credits.ts`：片尾卡在最后一句唱完前几秒才建；`overlay.ts`：取景器画框
- `lumiereDarkField.ts`：暗场底（tuning `darkField`，浅色主题保底 0.94）是运行时铺在所有场景与片尾卡之下的一整块底，不随段落转场变化；光场着色器的 `uDark` 在 folia 里恒为 0
- 歌词字号由光位的文字区决定，通用字号设置只影响底部字幕

## Host surfaces

不要只在主播放器里验证 visualizer。统一 renderer 当前被这些宿主复用：

- `src/App.tsx`
- `src/components/modal/ThemePark.tsx`
- `src/components/visualizer/VisPlayground.tsx`
- `src/components/obs/ObsBrowserSourceApp.tsx`
- `src/components/obs/ObsWebSourceApp.tsx`

宿主可以提供不同的 `staticMode`、背景、面板和字幕 props，但模式契约仍来自 `definition.ts`。

## Runtime guardrails

- 连续播放时间优先使用 MotionValue、ref、CSS/Motion、canvas 或 Pixi draw loop；不要每帧写 React state/store。
- React state 只保存当前行、播放状态、可见段落等离散变化；高频 `requestAnimationFrame`、`useMotionValueEvent`、`ResizeObserver` 必须有相等保护和 cleanup。
- 布局 cache key 要包含歌词内容、主题、最终字重、窗口尺寸和 mode tuning；字体测量和最终渲染必须使用同一 `resolveThemeFontWeight` 结果。
- 新模式应复用 `runtime.ts`、`registry.tsx`、`VisualizerShell.tsx`、共享 subtitle/harmony overlay 和 `entry.tsx` settings contract。
- 新功能若让单个模式文件继续明显膨胀，加载 `file-modularization` skill，把 layout、canvas/Pixi、tuning 和纯计算拆到同目录文件。

## Fast lookup

```powershell
rg -n "VisualizerRenderer|VisualizerSharedProps|VisualizerMode|import.meta.glob|applyVisualizerTuning" src/components/visualizer src/types.ts
rg -n "getLineRenderHints|getLineRenderEndTime|buildPostLyricLayoutUnits|buildLineGraphemeTimeline" src/components/visualizer src/utils/lyrics
rg -n "Pendolo|Sonnet|Tempera|Diorama|Pixi|Canvas|pretext" src/components/visualizer
```

先看命中的入口和相邻 helper；只有需要修改具体模式时才继续读取该模式目录。
