# 饭角搜索：不依赖 HAR 的原生验证

<!-- 当前文件记录官方公开请求用法与只读搜索兼容性，不代表全部饭角接口适用。 -->

日期：2026-09-14。结论：本次测试中，Node.js 使用现有签名规则和 `sm_device: 1` 即可搜索及翻页，不需要读取 HAR、用户登录态、运行数美 SDK 或额外启动浏览器。

这修正了此前“搜索必须先独立初始化 SDK”的判断：先前只对照了缺失 header 与真实设备上下文，没有验证官网公开客户端的固定标记。完整 SDK 初始化仍未实现，但它不再是已测试搜索路径的前置任务。

## 1. 公开来源与证据范围

来源链为 [饭角官网](https://www.fanjiao.co/) → 页面引用的 [app.5085240e.js](https://www.fanjiao.co/js/app.5085240e.js)。

- 官网 HTML 包含数美 Web SDK 装载代码，但 `publicKey` 字段是占位符；不能仅凭这个静态配置宣称 SDK 已可用。
- 主 bundle 中的设备 getter 调用 `SMSdk.getDeviceId/ready`；验证码相关流程使用其结果作为 `sms_device`。
- 同一 bundle 的部分账户请求封装实际使用固定请求头 `sm_device: 1`。
- **没有在该 bundle 找到搜索调用**。因此“固定标记可用于搜索”是另做的兼容性实测结论，不是声称官网搜索源码如此实现。没有重放账户、验证码或登录请求。

数美的 [Web SDK 文档](https://help.ishumei.com/docs/tw/sdk/web/developDoc/)提供正式初始化接口，但此次最终搜索路径不执行 SDK，也不需要这些初始化参数。

## 2. 已测试请求

```text
GET https://api.fanjiao.co/walkman/api/search/keyword
query: keyword, page, size, type=2
explicit headers: signature, sm_device: 1
body: none
```

签名沿用已与官方 HAR 核对一致的算法，密钥由本地文件或环境变量提供，不写入源码。`--ua default` 不显式伪装成 Android UA，其他标准 header 由 Node fetch 设置。

| 关键词 | page / size | total | 当页结果 |
| --- | --- | --- | --- |
| 春 | 1 / 3、2 / 3 | 13 | 各 3 个；专辑身份与之前真实设备上下文的结果一致 |
| 白月光 | 1 / 3、2 / 3 | 12 | 各 3 个，两页 ID 不重复 |
| 冬日花火 | 1 / 20 | 1 | 专辑 111726，与官方捕获一致 |
| 冬日花火 | 2 / 20 | 1 | 空数组，业务码仍为 0 |
| zzzfolianomatchqv | 1 / 3、2 / 3 | 83 | 各 3 个；再用真实设备上下文对照，两页 ID、顺序和分页字段完全一致 |

所有请求均 HTTP 200、业务码 0。最后一个词本想用作零结果样本，但服务端仍返回列表，所以**没有把它计为零结果验证**；其检索/分词语义未确认。另一混合词 `folia接口验证20260914` 也返回结果，不能只凭人工判断“不像剧名”就认定服务端应返回空列表。

比较依据是响应结构、分页数值和实际专辑 ID，不只是 HTTP 状态。没有用推荐列表替代搜索，也没有在客户端伪造搜索结果。

追加单变量对照：同一“冬日花火”查询、同一签名，只改变 `sm_device`。缺失 header 与空字符串均返回 60108；字符串 `1`、`0`、`abc`、`false` 均返回 code 0、total 1、专辑 ID 111726。当前行为更符合非空检查，而不是对这些样本验证真实设备指纹；这只是有限输入、当前搜索端点的实测，不能证明所有字符或其他接口都适用。产品仍采用有官网来源的固定标记 `1`。证据：`test-results/fanjiao-sm-device-values.json`。

## 3. 本地复现

```powershell
node test/manual/fanjiao/contract-probe.mjs --secret-file 'D:/ZZZode/backup/fanjiao-local3/.secret' --official-web-marker --ua default --mode search --keyword 白月光 --size 3 --out test-results/fanjiao-search-native-web-marker.json
```

也可从 `FANJIAO_SIGNATURE_SECRET` 读取密钥并省略 `--secret-file`；因此运行不依赖 Python 项目本身，仅需要提供接口签名凭据。

`--official-web-marker` 是显式选择，限定 `--mode search`，不能与 `--context-har` 同时使用；不会在真实上下文失败后静默兜底为固定标记。报告记录 `contextSource: official-web-marker`，以区别两类实验。

本次证据（均在已忽略的 `test-results/`）：

- `official-web-research/index.html`、`app.js`：从官网实际获取的公开资源。
- `fanjiao-search-official-web-marker.json`：春，两个非空页。
- `fanjiao-search-native-web-marker.json`：白月光，默认 Node UA。
- `fanjiao-search-title-web-marker.json`：精确剧名与空末页。
- `fanjiao-search-unmatched-web-marker.json`、`fanjiao-search-unmatched-device-control.json`：两种 header 用法的列表/分页一致性对照。

## 4. 实现决定与限制

1. 搜索可以先实现为纯 Node 请求模块，接入 Omni 的专辑搜索，不额外引入 SDK 浏览器初始化进程。
2. 保留业务码和结构检查。`60108` 不能一概解释为敏感词；请求成功后仍需验证 `data.list/paging`。
3. 固定标记的可用性只是当前服务端与所测公开目录接口的行为，不是长期稳定承诺，也不代表生成了真实设备上下文。
4. 不把该用法自动推广到验证码、登录、购买、账号数据或播放授权；这些能力仍需分别核对实际合同。
5. 下一步回到单集播放验证：确认访问资格、可播放来源、拖动与字幕。只有实际需要真实上下文的接口出现后，再针对它研究 SDK 获取器。

交付包含原生只读探针、复现命令与证据；尚未注册 Folia 运行时 provider。此次没有新增运行时依赖、执行 SDK、修改备份 Python 项目或运行完整构建。
