# 饭角原生接入：第一步接口核对

<!-- 当前文件记录接口证据、未确认项和原生接入边界，不代表播放功能已实现。 -->

核对日期：2026-09-14。目标：Folia 桌面端，以 TypeScript / Node.js 实现饭角服务，通过 Omni 与 Electron IPC 接入。

参考代码：本机 `D:/ZZZode/backup/fanjiao-local3` 的 `engine/` 与 `Ready/`。这份备份是协议线索，不是上游接口规范。下文相对的 Python 路径均基于该目录。

## 结论与当前范围

- **实测成立**：Node.js 24.16.0 可直接获取专辑详情、分集列表、单集详情；这些请求不依赖 Python、用户 token 或 GET 请求体。
- **搜索已通过不依赖 HAR 的实测**：官网公开客户端的 `sm_device: 1` 用法可用于本次搜索与分页，默认 Node UA、新签名即可调用。完整 SDK 初始化不再是搜索前置条件，详见 [原生搜索验证](fanjiao-web-search.md)。
- **单集播放已验证**：`src` 仍不能直接作为 URL；后续对福利样本 `120361` 通过实时 VOD 解析、原生 TS 处理及 HLS 播放完成整集验证，详见 [阶段二结果](fanjiao-playback-validation.md)。其他内容的播放与权限规则尚未推广。
- **资格语义尚未确认**：零价格样本仍返回 `user_has_eligibility: false`；不根据价格、`is_payment` 或授权字符串存在与否自行推断播放权限。
- 本文主体保留第一步的元数据合同与当时的核对记录；后续已经注册正式 provider，参见 [桌面接入](fanjiao-desktop-integration.md)。没有进行登录或购买操作。

## 1. 请求与响应约定

基址：`https://api.fanjiao.co`。以下目录及详情操作都是 `GET`。

| 项目 | 当前证据与实现约束 |
| --- | --- |
| 签名 | 旧实现对原始参数按键排序，生成 GET canonical payload，再计算 `signature`；中文在签名时不做 URL 编码。请求 URL 单独编码。参考 `engine/signature.py:45-57`。 |
| 凭据来源 | 现有 `FANJIAO_SIGNATURE_SECRET` 或备份项目 `.secret`，只在主进程或核对进程中读取；不复制进前端、源码或报告。 |
| Header | 专辑/详情无需设备上下文即可成功；搜索的已验证显式集合可缩小为 `signature`、`sm_device: 1`，使用 Node 默认 UA。该标记不是生成的设备指纹，不把此结论推广到账号或播放接口。 |
| GET body | 旧 `request_audio_payload` 附 JSON body；本次单集详情只用 query 即成功，原生请求可省略这个 body。参考 `engine/media.py:290-320`。 |
| 响应外壳 | 成功样本为 `{ data: object, code: 0, message: string, ttl: number }`；HTTP 成功与业务成功必须分别检查。 |
| 错误 | HTTP 200 仍可能业务失败。保留业务码；协议错误、网络失败、拒绝访问与空列表要分开处理。不要默认把缺失 `code` 当成功。 |
| URL | 主进程内部必须保留原始完整 URL；日志只留 host、扩展名和 query 参数名。返回给界面的目录 DTO 不承载临时凭据。 |

`engine/http.py:38-59` 与 `engine/media.py:270-287` 存在两份请求封装，默认 UA 不同；后者的 `request_audio_payload` 还漏掉了业务码检查。原生实现应合并请求边界，不直接照搬这些差异。

## 2. 核心端点

| 能力 | 路径与参数 | 响应 data 与状态 |
| --- | --- | --- |
| 搜索专辑 | `/walkman/api/search/keyword`；`keyword`, `page`, `size`, `type=2` | `list` 为专辑，`paging` 为专辑分页。当前可使用官网固定标记；不要把同时返回的 `user/comic_list` 当作专辑列表。 |
| 专辑详情 | `/walkman/api/album/album_info`；`album_id` | 专辑 object。样本 `111401` 实测成功。 |
| 分集目录 | `/walkman/api/album/audio`；`album_id` | `audios_list`, `update_frequency`, `play_history`, `is_payment`。样本返回 38 集。 |
| 单集详情 | `/walkman/api/audio/info`；`audio_id` | 元数据、播放相关字段、字幕地址、`access_info`。样本 `116966` 实测成功。 |

### 搜索与分页

旧实现约束：非空关键词、`page >= 1`、`1 <= size <= 50`，默认 `page=1,size=20,type=2`。这是客户端校验，服务端上限未实测。参考 `engine/media.py:323-359,399-410`。

旧包装期望 `paging.page/page_size/total`，缺失时回填请求页和尺寸并令 total 为 0。**原生实现不要复制这种兜底来判断搜索成功或分页结束**。已实测第一页、非空第二页和超出末页；完全不命中关键词的零结果搜索尚未验证。

最初未提供 `sm_device` 时的结果：

| 关键词 | 参数差异 | 结果 |
| --- | --- | --- |
| 白月光 | page 1/2，size 3，显式 app UA | `60108`；初次报告只记录码和响应形状 |
| omega | page 1，size 20，不显式设置 UA | `60108`，文案“你的输入包含敏感信息系统无法搜索，请重试” |
| 春 | page 1，size 20，显式 app UA | 相同业务码与文案 |

这组初始样本本身不足以定位原因，UA 对照也不是严格单变量实验。后续成功 HAR 的减字段实验才定位到缺少 `sm_device`；业务失败始终不能降级为成功空列表。

### 搜索问题追加诊断

2026-09-14，用户确认官方饭角 App 能正常搜索。针对旧实现与原生探针的差异，追加以下检查：

| 检查 | 结果与能支持的结论 |
| --- | --- |
| 旧 `fanjiao2.py:289-301` 的参数 | 旧请求只有 `keyword,size,type=2`，没有 page；同样是 GET、没有 JSON body。 |
| 移除 page，使用“春”及 size=20 | 仍 `60108`；page 的加入不是当前失败的唯一原因。 |
| 旧脚本的签名常量与 `.secret` 比较 | 一致；仅输出布尔结果，未输出或复制密钥。 |
| Python urllib 重现无 page 的旧请求 | 仍 `60108`；不能归因于 Node fetch 独有的实现问题。 |
| 直接调用 `engine.media.search_albums` | 实际执行 `search_albums("春", read_secret(), size=20, page=1)`，抛出 `RuntimeError: api_code=60108 message=你的输入包含敏感信息系统无法搜索，请重试`，退出码 1。此项直接调用原模块，区别于前面的请求逻辑复现。 |
| 直接执行未修改的 `fanjiao2.py` | 输入“春”，原脚本在 `:318` 的 `for item in list_data` 抛出 `TypeError: 'NoneType' object is not iterable`，退出码 1。原脚本从响应中取到的 `data.list` 为 null，但未检查业务码；这次终端未输出具体业务码，不能把 urllib 实测的码当作本次原脚本直接打印的结果。未进入专辑选择或下载。 |
| `/walkman/api/search/guide` | HTTP 200、code 0；返回一个主建议词及 8 项建议列表，本次主建议词为“冬日花火”。 |
| 先读 guide 再搜索“冬日花火” | 仍 `60108`；guide 与 keyword 响应均未设置 Cookie。旧源码也没有复用 guide 的会话状态。 |
| 同一建议词附 JSON GET body | Python urllib 请求仍 `60108`；仅补 query 对应的 body 没有恢复搜索。 |
| 参考目录中的抓包记录 | 没有发现 `.har` 或搜索响应 JSON；现有搜索测试都是 mock，不能用来证明线上成功。 |

官方[隐私说明](https://www.fanjiao.co/pages/useragree.html)描述游客可使用搜索等基础功能，但这不构成当前 API 的请求合同，也不能证明匿名请求不需要客户端上下文。不能把“加登录 token”直接认定为修复。

### 成功 HAR 与已验证修复

用户随后提供 `docs/fanjiao/page.fanjiao.co_2026_09_14_11_34_37.har`。`log.entries[55]`（从 0 起）为成功搜索：keyword=冬日花火、page=1、size=20、type=2，`data.list` 只有专辑 `111726`，`data.paging={page_size:20,page:1,total:1}`。请求含 JSON GET body、`signature/sm_device/x-uuid/user-agent`，没有 token、Cookie 或 Authorization。该 HAR 已加入 Git 忽略规则，凭据没有复制到源码或报告。

使用相同 URL、关键词及设备上下文，原生 Node 重放与减字段结果如下：

| 对照 | HTTP / 业务码 | 搜索结果 |
| --- | --- | --- |
| 捕获请求基线 | 200 / 0 | 1 个专辑，ID 111726 |
| 只去掉 `sm_device` | 200 / 60108 | list 与 paging 为 null |
| 只去掉 `x-uuid` | 200 / 0 | 同基线 |
| 去掉两个设备 header | 200 / 60108 | 同失败结果 |
| 去掉 GET body | 200 / 0 | 同基线 |
| 用现有签名函数重新签名 | 200 / 0 | 同基线；计算值与 HAR 的签名一致 |

该轮对照将问题定位到缺失 `sm_device` header，不能把这次 `60108` 解读为关键词被禁止、必须登录或签名算法改变。它当时只证明真实上下文有效；后续官网固定标记也通过了独立搜索实测，详见文首链接。不能由此进一步推断任意值均有效。

探针随后使用**新关键词、新页码、新签名**验证，不再只重放 HAR：显式 header 仅 `signature/sm_device/user-agent`，普通 Node fetch，query-only，无 `x-uuid`、GET body 或用户登录凭据。

| 关键词与页码 | size | 专辑 total | 当前页数量 | 专辑 ID |
| --- | --- | --- | --- | --- |
| 春，page 1 | 20 | 13 | 13 | 报告保留完整 ID 列表 |
| 春，page 2 | 20 | 13 | 0 | 空列表，非业务错误 |
| 春，page 1 | 3 | 13 | 3 | 162、367、100343 |
| 春，page 2 | 3 | 13 | 3 | 323、147、104622 |

两张非空页没有重复 ID，服务端返回的 page/page_size 与请求一致。原生 provider 可按返回的 `page * page_size < total` 判断后续页，并按实际消费数量推进 offset；只有成功响应且 `data.list` 为数组才可执行分页映射。不要拿 `user_paging` 的 total 混算。

**真实上下文的后续研究（非搜索前置）**：`--context-har` 只用于开发对照，每次在内存里读取真实 `sm_device`，不把 HAR 作为发行依赖。只有实际需要真实上下文的能力出现时，再核对其初始化、缓存、过期和更新流程；当前搜索可以使用已验证的官网固定标记。

后续完整启动记录确认先沿用旧值、再切换新值，且新旧值短时均有效；没有观察到返回设备值的 HTTP 响应。SDK 资料与有限客户端检查提供了数美线索，证据见 [设备上下文核对](fanjiao-device-context.md)。完整 SDK 初始化仍未实现，但不再阻塞已验证的搜索路径。

### 专辑与分集字段

| 实体 | 字段 | 原生接入约定 |
| --- | --- | --- |
| 专辑 | `album_id`, `name`, `description`, `cover`, `square`, `horizontal` | 映射 `ProviderCollection` 的 album；内部统一 ID 为字符串。 |
| 专辑 | `author_name`, `up_name`, `cv_list_name`, `tags` | 保留作者、上传者和配音信息的区别；不要未经确认把作者 ID 当作歌手目录 ID。 |
| 专辑 | `price`, `ori_price`, `is_payment`, `is_public`, `state`, `is_over` | 样本为 number；币值单位和枚举含义尚未确认，保留原值。 |
| 分集 | `audio_id`, `album_id`, `name`, `description`, `duration`, `size` | 每集映射 `UnifiedSong`；播放身份为 `online:fanjiao:<audio_id>`。 |
| 分集 | `is_positive`, `publish_date`, `is_payment`, `is_public`, `price` | 保持服务端顺序；正片/花絮、发布时间与访问资格不能互相替代。 |
| 分集 | `src`, `preview_src`, `encrypt_src`, `play_auth`, `subtitle` | 元数据和播放准备分开。必须验证 URL 形态，不能把非空字符串直接写入 `<audio src>`。 |

时长：旧 GUI 按秒格式化 `duration`（`fanjiao/gui/pages/album_page.py:190-199`），本次样本数值为 162。Folia 歌曲元数据 `durationMs` 使用毫秒，映射时乘 1000；与真实媒体时长的吻合度留到第二步验证。`size` 的字节解释来自旧媒体实现，本次未下载文件核对。

分集接口旧代码没有 page/size 参数，本次 `audios_list` 返回 38 个元素；这不能证明任意大专辑都一次返回完整目录，也没有独立 total 可核实完整性。参考 `engine/media.py:362-387`。

旧项目存在两份不同的 `public_album_item`：`engine/util.py:33-70` 用于首页/分类/详情，`engine/media.py:414-427` 用于搜索。后者字段更少、别名兼容不同。新服务应从 raw response 建立统一 DTO。

## 3. 播放、音质与时效

当前详情样本 `audio_id=116966`：

| 字段 | 实测 |
| --- | --- |
| `src` | 非空，184 字符，无法作为 URL 解析；未记录内容、未尝试解码 |
| `play_auth` / `encrypt_src` | 均为非空字符串；内容不写入报告 |
| `auth_timeout` | `3000` |
| `now_unix` | number，与请求时刻相近 |
| `encrypt_infos` | 三个 `{ definition, size }` 项：HQ / SQ / FD |
| `subtitle` | HTTPS，host `static.rela.me`，`.json`，当前样本无 query |

旧程序通过 `audio/info` 获得临时播放信息，再解析媒体候选。该链路只是已存在的参考实现，本次没有调用其后续步骤。

- `auth_timeout` 与 `now_unix` 可作为时效建模线索；不能把 `3000` 无条件套到所有音频、字幕和封面 URL 上。
- 旧媒体请求另传 `AuthTimeout="3600"`（`engine/media.py:181-192`），它是请求参数，不是服务端保证；与上面的 `3000` 是不同证据。
- 旧实现只识别 `expired` 类错误文字，没有自动刷新与播放重试，Ready 下载失败也只支持显式重试。
- 后续原生实现应在开始播放时获取当前授权信息；遇到明确的过期错误时至多进行受控刷新，避免把资格失败当过期无限重试。
- Folia 的 `ProviderAudioSource` 已有 `fetchedAt/expiresAt`，但必须先确认每种资源的有效期再填值。[类型定义](../src/types/onlineMusic.ts#L81)
- FD/SQ/HQ 不能直接等同于 Folia 的 standard/high/lossless/hires。本次只有档位与大小，没有 codec、bitrate、采样率及实际媒体证据，不能把 HQ 宣称为无损。

旧 `sanitized_url` 会删除 query（`engine/media.py:786-793`），公开目录的 `src/subtitle` 都经过它（`:448-450`）；`Track.public_dict()` 还删除实际 `play_url`（`:65-68`）。因此 Ready 的公开 DTO 不能直接充当播放服务返回值。

## 4. 访问资格和账号

本次未发送用户登录 token。样本详情同时出现：

```json
{
  "price": 0,
  "is_payment": 0,
  "is_public": 1,
  "access_info": {
    "access_type": 3,
    "is_time_limited": false,
    "user_has_eligibility": false
  }
}
```

这些值证实字段存在，**不能证明 access_type=3 的含义，也不能单靠 `is_payment=0` 区分“免费内容”和“尚未购买”**。在资格语义得到验证之前，源可播放状态保持 `unknown`，不能因 `play_auth` 存在就宣告 `playable`。

样本专辑的 `price=259`，但选到的分集价格均为 0，没有覆盖正价格单集。因此付费、已购、登录过期与明确资格不足四类响应都仍需补样本。旧 `Ready/README.md:225-233` 也明确说明 token/eligibility 支持尚缺失。

## 5. 字幕合同

当前只确认了字幕资源地址和扩展名。由于样本未满足探针的“零价格且明确有资格”条件，本次没有拉取字幕正文；下述结构来自旧解析器和离线测试，尚不是当前线上响应证明。

`engine/media.py:887-916` / `test_fanjiao_media.py:189-208`：

```text
root.content[]
  content: string
  newStart || startTime: "HH:MM:SS:MS" 或 "HH:MM:SS"
  newEnd   || endTime:   同上
```

旧测试中 `01:02:03:45` 表示 1 小时 2 分 3 秒 45 毫秒，不是 450 毫秒。新转换器应转换为 Folia 的秒制行时间：`h*3600 + m*60 + s + ms/1000`，输出 `Line { fullText, startTime, endTime, words: [] }`。

`ProviderLyricsResult.lyrics` 可直接接收 `LyricData`，无需先落盘 SRT 再解析。[类型定义](../src/types/onlineMusic.ts#L106)

旧解析器不检查时间倒置、排序、重叠或缺失起止时间；后续转换器需要明确定义这些情况。当前合同只有句级时间，`wordByWordLyrics` 应为 false；没有证据支持人物识别或精确逐字时间。

## 6. 可选目录能力：仅静态确认

| 能力 | GET 路径 | 参数／代码参考 |
| --- | --- | --- |
| 首页 tabs | `/walkman/api/recommend/home/tab` | 无参数；`engine/api.py:20-39` |
| 首页内容 | `/walkman/api/recommend/home/limit` | `is_teen,page,size,tab_id`；`:42-145` |
| 分类清单 | `/walkman/api/album/category` | 无参数；`:148-164` |
| 分类内容 | `/walkman/api/recommend/category` | `cate_id,page,size`；`:167-183` |
| 筛选项 | `/walkman/api/search/classify/filter` | 无参数；`:186-199` |
| 筛选结果 | `/walkman/api/search/classify/index` | `page,size`，可选 `category/style/is_over/is_buy/sort`；`:202-251` |

上述接口未做线上验证，也未被擅自用作搜索失败的替代路线。

## 7. Folia 接入决定与下一步条件

1. 采用 `Omni → fanjiao provider/transport → Electron IPC → Node 饭角服务`。本次已证明元数据请求无需 Python；媒体处理实现尚待第二步验证。
2. 现有 `OnlineSearchProvider` 只有 `searchSongs`，饭角搜索返回专辑；需扩展 Omni 的专辑搜索合同，不把整部广播剧伪装成可播放单集。[现有接口](../src/types/onlineMusic.ts#L206)
3. 专辑详情和分集可使用 `getAlbumDetail/getAlbumTracks`；保留 provider ID 与目录引用。[现有接口](../src/types/onlineMusic.ts#L275)
4. 搜索已通过真实上下文和官网固定标记两种实测；显式采用后者可不依赖 HAR 或 SDK。业务失败需显示错误，不返回伪空列表。账号、收藏、修改等能力在实现前不启用。
5. 接下来补访问资格语义和明确可播放样本。第二步验证首播、拖动、格式和过期刷新；只有实际需要真实设备上下文的接口出现后，再单独核对其 SDK 初始化和更新。当前报告不能作为“播放已经可用”的验收依据。

尚未解决：零结果关键词搜索、访问资格枚举及登录样本、可播放 URL/媒体格式、资源有效期边界、当前字幕正文结构、大专辑目录完整性。真实设备上下文生命周期也仍未知，但不再是已测试搜索的阻塞项。这些是具体的后续验证项，不用旧 README 的结论补空白。

## 8. 复现与证据

探针：[test/manual/fanjiao/contract-probe.mjs](../test/manual/fanjiao/contract-probe.mjs)。Node 内置模块，无新增依赖；只输出脱敏摘要，默认写入已忽略的 `test-results/`。不自动重试业务失败。

在项目根目录执行（凭据文件只读取、不复制）：

```powershell
node test/manual/fanjiao/contract-probe.mjs --secret-file 'D:/ZZZode/backup/fanjiao-local3/.secret' --mode album --out test-results/fanjiao-album-check.json
node test/manual/fanjiao/contract-probe.mjs --secret-file 'D:/ZZZode/backup/fanjiao-local3/.secret' --official-web-marker --ua default --mode search --keyword 春 --size 3 --out test-results/fanjiao-search-web-marker.json
```

也可从环境变量 `FANJIAO_SIGNATURE_SECRET` 读取，此时省略 `--secret-file`。`--mode full` 合并两组核对，`--album-id` 改专辑样本，`--ua default` 不显式设置 UA。任一 API 请求 HTTP/业务失败时进程退出码为 1；字幕另在摘要中记录成功、失败或跳过，API 退出码为 0 不代表字幕和媒体通过验收。

搜索诊断选项：`--omit-page` 只请求一次且不传 page，以复现旧脚本；`--keyword-from-guide` 先读取真实建议词再搜索。两项可组合；不会把失败结果替换成首页或推荐列表。

`--official-web-marker` 显式使用官网固定标记，限定搜索模式，不读取 HAR。`--context-har` 可用于真实设备上下文对照，二者互斥；两者都省略时复现缺少 header 的请求。HAR 模式不导入用户 token/Cookie/Authorization、`x-uuid` 或捕获的签名。另有 [search-har-probe.mjs](../test/manual/fanjiao/search-har-probe.mjs) 用于最多六次逐项对照；使用 `--har <本机文件>` 和同一 `--secret-file` 即可运行，失败基线不会继续请求。两个探针共享 [searchCapture.mjs](../test/manual/fanjiao/searchCapture.mjs) 的捕获解析。

本次本机证据：`test-results/fanjiao-contract.json`（初次核对）、`fanjiao-search-check.json`（omega）、`fanjiao-search-neutral.json`（春）、`fanjiao-album-check.json`（详情复核）。报告保留形状和允许输出的元数据，没有签名值、播放授权内容、完整音频 URL 或字幕正文。

追加证据：`test-results/fanjiao-search-without-page.json`、`fanjiao-search-guide-check.json`、`fanjiao-search-body-check.json`；Python 原请求复现和密钥一致性检查另见本任务工具输出。

修复证据：`test-results/fanjiao-search-har-check.json`（六组对照）、`fanjiao-search-fixed-pages.json`（size 20 含空末页）、`fanjiao-search-fixed-pagination.json`（size 3 两张非空页）。没有修改备份目录中的 Python 源文件，也尚未注册 Folia 运行时 provider；当前交付是可复现的接口合同与原生探针。

验证方式：探针语法检查、实际只读请求、文档与代码定位、`git diff --check`。未运行完整构建，也未重启正在运行的开发服务。
