# 饭角收听数据同步协议 v1

<!-- 客户端、Node、Docker 与 Workers 共用 shared/fanjiaoSync.mjs 的解析和合并契约。 -->

## 使用与升级

在「存储设置 → 同步服务」点击「同步饭角数据」，直接同步收听记录与续播位置。按钮位于「同步 AI 主题」「同步视觉设置」右侧，无需额外勾选；只需启用并配置同步服务。命令面板也保留同名同步动作。

仅手动同步。五秒进度写入、暂停和退出只保存本机，不触发网络请求。历史、首页继续收听和分集进度共用记录；正片播放偏好仅保存在本机，客户端不上传、下载或应用旧 journal 中的播放偏好。旧的两个类别开关会被忽略，文件导入导出仍仅覆盖原有主题和外观。

服务端须升级到声明 `GET /health → capabilities.fanjiaoSync: 1` 的版本。Node 重新构建并启动；Docker 重新构建镜像；Workers 重新部署。新表在第一次饭角请求时幂等创建，无需清空数据库。旧客户端的 `/settings`、`/themes/*` 和顶层 schema version 1 保持兼容；连接旧服务端的新客户端会显示升级提示，原有同步功能仍可用。

## 操作顺序与冲突

- 版本为 `{ counter, device }`：device 是本机持久随机标识；counter 取 `max(Date.now(), 已观察计数 + 1)`，因此系统时间回拨、同毫秒操作或观察到时钟较快的设备后，后续操作仍递增。比较先看 counter，再按 ASCII device 顺序裁决；不用服务端请求到达时间。
- 完全离线且互不知情的操作无法确定真实先后，按上述顺序确定唯一结果；时钟偏差可能影响这类并发冲突的胜者。收到远端版本后本机计数继续递增，不会被远端的未来时钟永久锁住。`updatedAt`、`lastPlayedAt` 是展示数据，不承担协议顺序。
- 历史有全局 `epoch`（清空版本）；逐集记录还有 `generation`（重听／删除版本）和 `version`（进度版本）。先比较 epoch，再 generation，最后 version。普通保存只能沿用已有 epoch 和 generation。
- 显式从头播放、已完成后重新播放和删除都提升 generation。删除保存 tombstone。旧会话的进度无论播放位置或 version 多大都无法覆盖新 generation；设备观察到删除后，明确重听或开始新的播放会话可以重建记录。两个离线设备同时执行重听／删除时，较新的 generation 胜出。
- 清空提升 epoch；不属于当前 epoch 的记录整体失效。旧设备再次上线不能把原历史带回来。在清空前仍离线产生的记录也会被清空；同步获得新 epoch 后再次收听可重建。
- 同版本优先保留补齐的展示元数据，再按标准化 ASCII JSON 裁决。完全相同的重试幂等，乱序提交与客户端纯合并得到相同结果。补齐元数据、暂停后的重复 flush 不增加收听操作版本或真实收听时间。
- 远端胜出时，正在播放的分集保持当前会话显示；该会话的后续保存不上传旧进度，会话释放后应用持久化的远端胜者。重启也从 journal 恢复胜者。同步不调用播放器 seek、换集或队列替换；续播仍通过 Omni 取资源。

## 持久化、容量与重试

`folia_fanjiao_sync_v1` 保存设备身份和逐集操作 journal；旧 `folia_episode_progress_v1` 是兼容的最近 2000 条展示缓存。迁移沿用旧进度和旧时间，不把打开应用视为收听。超过展示上限的淘汰不是删除；journal 保留最新逐集操作，作为可重试的待同步数据，不需要另一份 outbox。

每次上传收听记录的最新操作，上传分批，完成后分页下载并逐条合并。网络失败保留 journal 和本机数据，下一次重发相同版本。多次点击由 coordinator 合并为一次执行。服务地址或密钥改变会生成新的本机 scope；旧作用域的 tombstone、清空版本不带入新服务，重新从本机现存记录合并，旧请求结果不再应用。

- 每批／每页最多 100 条，请求体最多 1 MiB。
- 每集最长 7 天；标题、专辑名、作者最多 512 字符，专辑身份 128 字符，封面输入 2048 字符。
- 服务和本机 journal 最多 10000 条记录，包含 tombstone。超限拒绝写入，不静默丢弃。
- tombstone 不按时间自动回收，以支持任意长时间离线的设备。显式清空形成永久 epoch 屏障后，旧 epoch 的行可原子回收。不能仅删除旧 tombstone 来释放空间。
- 只序列化分集身份、进度、时长、完成、时间和展示字段。封面仅保留公开 HTTPS 图片路径，移除查询与 fragment；不传饭角凭据、媒体 URL、授权、本机资源或音频缓存。

## HTTP 与数据库

所有饭角接口均要求现有 Bearer 鉴权，返回 `protocol: 1`。服务沿用同一服务与密钥共享一份数据的模式。

| 接口 | 请求／响应 |
| --- | --- |
| `GET /fanjiao/history?cursor=...` | `{ protocol, history: { epoch, records }, cursor }`；cursor 是最后一条稳定分集键或 null |
| `POST /fanjiao/history` | `{ protocol, history: { epoch, records } }`；原子合并，返回 `{ ok: true, protocol: 1 }` |
| `GET /fanjiao/preference` | 仅兼容旧客户端；当前客户端不再调用 |
| `PUT /fanjiao/preference` | 仅兼容旧客户端；当前客户端不再调用 |

服务端在 `fanjiao_meta` 存 epoch／偏好，在 `fanjiao_records` 存逐集行。比较由 SQL 条件 upsert 完成，不读整库再覆盖；推进 epoch、回收旧行和批量合并处于同一事务。容量触发器失败也回滚整个请求。Node 的 D1 emulator 同步执行事务内语句，以可靠捕获错误。

Workers 使用 D1 的 [batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/) 和 [JSON SQL](https://developers.cloudflare.com/d1/sql-api/query-json/)；共享 `.mjs` 和声明文件由 Docker 显式复制，保持原 `/app/dist/node.js` 启动路径。

## 验证

```sh
npm run test:unit -- test/unit/sync test/unit/playback/episodePlayback.test.ts test/unit/playback/episodeHistory.test.ts test/unit/command-palette/commandRegistryContract.test.ts
npm run test:component -- test/component/fanjiaoSync.spec.ts
npm run typecheck
npm --prefix sync-server run build:node
```

`fanjiaoServer.test.ts` 使用两份独立本机 journal 和真实 localhost HTTP 请求验证生产客户端、Hono 路由与 SQLite。Workers 可用独立空数据库运行 smoke（只允许 localhost；会执行重听、删除与清空）：

```sh
# sync-server 目录，新建独立测试持久目录，关闭时停止此进程
npx wrangler dev --local --config wrangler.toml --port 18787 --var SYNC_TOKEN:local-test-token --persist-to ./.wrangler/fanjiao-test
# 仓库根目录
node test/manual/fanjiaoSyncSmoke.mjs http://127.0.0.1:18787
```
