# openGym 私人 Agent 服务

2026-10-21：v0.6.0 源码增加自定义动作搜索与别名、列表，以及创建/修改/归档/恢复/删除的预览保存流程，共 23 个工具。删除仅限没有引用的动作；已使用动作优先归档。旧官方 APK 不识别归档筛选，参见[能力说明](PLUGIN_CAPABILITIES.md)。已于 01:27 Asia/Taipei 部署，服务端与公网只读验收通过；ChatGPT 工具刷新及实体 Android 实际操作仍需客户端验收。部署和回退记录见 [OPERATIONS.md](OPERATIONS.md)。

2026-10-18：v0.5.1 保留重要训练背景、统一备注检索、体重围度独立权限、局部纠错与撤销及进阶参数；移除仅限当天的临时开练和这轮新增的 App 界面改动，增加官方旧客户端回写保护。工具数 20。见 [能力说明](PLUGIN_CAPABILITIES.md)和[上游升级与补丁](PLUGIN_UPGRADES.md)。部署与验收以 OPERATIONS.md 为准；下文较早版本为历史记录。

2026-10-15：v0.3.1 实现了“读取实际训练 → 回顾历史 → 预览完整调整 → 确认保存”的闭环。已部署到原私人端点，健康检查及十三工具公网探针通过；镜像和回退信息见本机运维日志（根目录 `OPERATIONS.md`，不纳入 Git）。Android 普通聊天中的新版工具发现、重新授权、真实保存与手机同步仍需端到端验收；服务器测试不等于手机验收。

插件安装由部署者在自己的客户端创建；本仓库不包含原维护者的私人插件安装链接。

2026-10-18：v0.4.0 新增一次性注册链接、[朋友接入说明](https://gym.example.com/api/plugin/connect)、`get_profile` 当前连接账号识别和写入归属检查，MCP 共十四个工具。多人使用的账号隔离、独立 ChatGPT 账号接入与双账号测试见 [多用户 Plugin](MULTI_USER_PLUGIN.md)。部署记录见 OPERATIONS.md；个人目录链接不代表朋友已获得安装权限。

## v0.3.1：旧工具定义兼容与递减组

v0.3.0 将训练导入的 `timezone` 新增为必填，但 ChatGPT 中已缓存的旧工具定义没有这个参数，造成旧会话缺参报错。v0.3.1 将公开 schema 和内部校验共同改为可选，并用真实 OAuth/MCP HTTP 测试确认缺省调用可进入预览。

时区优先级是工具明确传入的 IANA 时区 → 账户 `reminder.tz` → 运维明确设置的 `PLUGIN_DEFAULT_TIMEZONE`。本私人部署的默认值是 `Asia/Taipei`。预览返回 `timezone` 与 `timezone_source`，确认摘要也显示二者；没有任何可用时区时明确拒绝，不猜服务器时区或 UTC。显式传入的无效时区仍拒绝。此兼容修复不增加权限，也不修改账户或训练数据。

新版逐组输入支持 `type: "dropset"` 和 `drops: [{weight: 30, reps: 8}, {weight: 20, reps: 6}]`；主组仍使用 `weight`、`reps`。每次递减重量须低于前一段。递减部分保留在一组里，逐段显示在预览中，训练量和汇总次数包含递减部分；同一记录的重复检测也比较递减段。单侧递减组分别保存到左右侧。

仍使用旧工具 schema 的客户端可以立即省略 timezone 进行普通导入；要传入新增的 drops/type 字段，必须先刷新客户端的工具定义。不能把递减段静默丢弃，或宣称仅写到备注等于结构化保存。没有接收原训练数据、仅有动作/组数概述时，不能据此重建或保存真实记录。

## 连接与权限

- MCP URL：`https://gym.example.com/api/plugin/mcp`
- 身份验证：OAuth，发现 + 动态客户端注册，无需管理员 Token。
- 连接时在同一浏览器登录已有 openGym 账号，再同意授权。已有手机账号不要重新注册。
- `plan:read`：训练模板、周安排、日期覆盖、轮转/队列、训练背景和近期 Agent 计划变更。
- `plan:write`：新增/编辑模板、日程、长期训练背景，以及预览后的安全撤销。
- `training:read`：训练历史、逐组明细、相关备注、今日实际目标、期间汇总。**旧授权不会自动增加此权限，需刷新工具并重新 OAuth 同意。**
- `training:write`：导入训练、备注；按训练 ID 纠错或删除还必须有 `training:read`。

没有账户管理、管理员、SSH、Docker、凭据或体重权限。`target.bodyweight` 是动作的自重标记，不是用户体重。撤销入口：[授权管理](https://gym.example.com/api/plugin/connections)。

## 十四个工具（v0.4.0）

| 工具 | 用途 |
|---|---|
| `get_profile` | 验证当前 OAuth 连接对应的账号，只返回本人稳定 ID、名称和显示标签 |
| `search_exercises` | 中文/英文动作目录，返回真实 ID 与候选；模糊变体需询问 |
| `get_current_plan` | 单位、模板、周安排、日期覆盖、轮转/队列、长期训练背景；原始单侧 reps 是双侧合计 |
| `get_training_session` | 指定日期的实际目标、开练组次、进阶原因、备注与后续日程；必须提供 IANA 时区，日期默认用户当地今天 |
| `list_training_history` | 1–93 天闭区间内的训练列表，按 `next_offset` 分页；返回记录 ID、组数、训练量、已知时长 |
| `get_training_workout` | 按记录 ID 读取每组、左右侧、RIR/RPE、力竭标记与备注；不按日期猜测某一条记录 |
| `get_training_summary` | 同区间的频率、工作组、训练量、肌群估计、动作证据、努力程度与缺失情况；可比较前一个等长周期 |
| `get_plan_versions` | 最近 Agent 计划变更、来源、时间、修订号，以及是否可以安全撤销 |
| `preview_plan` / `save_plan` | 追加新模板；保持原日程 |
| `preview_plan_edit` / `save_plan_edit` | 一次预览、一次保存多个模板和日程，或更新训练背景，或撤销一个版本 |
| `preview_training_update` / `save_training_update` | 训练导入、完整替换一条训练、删除一条训练及备注更新 |

所有写入仍需完整 preview → 用户明确确认 → 对应 save。必须原样复制 `confirmation_summary`，不能把一个工具的草稿交给另一个保存工具。保存成功之前不能声称“已更新”。草稿绑定账户与 OAuth 授权，有效 15 分钟；服务重启后重新预览。同草稿重复保存返回原结果，保存时检查 `_rev` 和 `_wid`。

## 推荐使用方式

**今日训练**：“按台北时间告诉我今天实际练什么，重量和次数为什么是这些？”Agent 调用 `get_training_session(timezone="Asia/Taipei")`。使用与 App 相同的日程解析器和合并训练构建器，覆盖日期休息、日期覆盖、队列 pin、轮转与多模板组合。不能把模板重量直接当成开练重量；未来目标会随新增训练而变化。

**月度复盘**：“分析 9 月 15 日到 10 月 14 日的训练，和前一个月比较，再调整接下来计划。”Agent 读取当前计划和 `get_training_summary`，必要时按 workout ID 读取明细。统计由服务端使用 App 计算器完成；Agent 负责解释、引用证据并提出调整。没有时长、努力程度或训练记录时表示未知，不补零、不编造；当前日程不证明过去的计划，因此不计算虚构的完成率。

**批量调整**：`preview_plan_edit` 可使用：

- `routine_id + operations`：编辑单个模板，兼容旧调用方式。
- `operations`：仅修改周安排或某天安排，不强制选择无关模板。
- `routine_edits: [{routine_id, operations}, ...]`：批量编辑最多 8 个模板。顶层 operations 先执行，然后按组顺序执行；索引均以每一步执行时的列表为准。总计最多 64 个操作，全部验证成功才生成草稿，保存仅推进一次修订。
- `training_profile`：完整替换目标、经验、每周次数、偏好训练日、单次时长、器械、限制、喜好和备注。复用 `coach.profile`，不会启用 Coach、设置其同意或调用模型。
- `restore_version_id`：单独预览撤销。只恢复模板、周安排、日期覆盖；训练历史和训练背景保持不变。当前计划必须仍等于该版本保存后的计划，单位或后续手动修改不一致时拒绝撤销。

日期安排 `routine_id="rest"` 表示明确休息；`null` 表示清除覆盖、恢复常规解析。批量调整保存后立即生效；当前没有延后生效或训练周期版本切换。

**记录纠错**：先按 ID 读取原训练，再提供 `workout_id` 和完整替换 workout；遗漏的训练字段不代表保留。删除用 `workout_id + delete_workout:true`，预览会明确显示原记录及删除动作。保存沿用原 ID 和同步时间戳，删除写入原同步删除记录，避免旧设备复活。不能在一次纠错中改训练日期；如需移动，应另行预览导入和删除。训练纠错/删除没有专用撤销工具，原文会出现在确认预览中，备份仍按运维流程保留。

## 次数、重量和统计约定

- 计划预览/编辑输入：最终 `per_side=true` 时，`reps` 表示每侧次数，服务端转换成 App 的 L+R 合计。因此每侧 10 次保存为 `reps:20, side:true`。
- 读取模板/目标：原始 `reps` 沿用 App 总次数；训练明细的 `sides.L/R` 是各侧真实值。
- 导入训练：单侧次数分别写入两侧；单侧计时拆成左右两行。只在原文明确时使用 per_side，不推断左右不对称记录。
- 重量使用账户 kg/lb；双哑铃可显式指定 `db_load` 为 `each`、`total` 或 `as`，否则继承模板/账户约定。模糊输入先询问。
- 有氧 speed 使用 km/h，输入 mph 时显式换算。时长需要有带时区的开始时间，训练日按用户 IANA 时区校验，未来日期拒绝。
- `completed_set_units` 包含已完成热身；`working_set_units` 和训练量排除热身。单侧各肢算一个完成单位，与 App 相同。估计 1RM 和肌群有效组数不是测量结果。
- 汇总按动作、模式、哑铃重量约定分组，避免直接比较“每只”和“合计”。时长、次数和努力程度可沿证据 ID 查到逐组原记录。
- 日期备注只更新指定字段；未传的文字或标签保留，`day_note:null` 可清除。长期动作备注只在明确要求时写入。

## 保存与安全边界

- 运行在原 API 的唯一同步写进程，沿用原持久化、同步戳和缓存失效。不会旁路覆盖整个账户状态。
- 计划版本与快照保存在账户状态内，随原备份和同步保留；最多 10 个版本、总计 1 MiB。只记录本功能产生的计划修改，手动编辑不会自动产生 Agent 版本；训练背景单独修改不产生模板/日程撤销版本。
- OAuth：授权码 + S256 PKCE、资源/客户端/回调绑定、一次性授权码、同源 POST + CSRF、固定 ChatGPT 回调白名单、RFC 9207 issuer。访问/刷新 Token 只保存哈希，刷新轮换；授权最多 30 天，访问 Token 最多一小时。旧授权不会增加范围。
- `confirmed:true` 和精确摘要改善可审查性，不是独立的人类点击证明，仍依赖宿主的确认/审批。平台拦截时应报告，不能绕过其他通道重试。
- 计划编辑与训练保存工具标记为可能破坏数据，因为包含替换/删除。训练自由文本是数据，不能当成 Agent 指令。
- 插件与上游 openGym 分开发布。上游状态结构或共享训练逻辑变更时，需要重新构建覆盖镜像并跑兼容测试，工具 schema 变化后要刷新工具，scope 变化后重新授权。
- `plugin.mcp` 日志只含工具名、阶段、状态、请求关联 ID 与分类原因，不记录参数、训练内容、账号 ID 或 Token。不能把 HTTP 200 直接当成业务保存成功。

## 验证和构建

```sh
npm ci --ignore-scripts --prefix api/plugin
npm test --prefix api/plugin
node --test api/test/sync-stamps.test.js api/test/queue.test.js api/test/server-data-rev-endpoint.test.js api/test/server-data-reset.test.js api/test/server-data-wid.test.js api/test/server-config-session.test.js
node mcp/scripts/check-node-loadable.mjs
npm ci --ignore-scripts --prefix mcp
TZ=UTC npm test --prefix mcp
docker build -f api/plugin/Dockerfile -t opengym-api:plugin-0.3.0 .
docker run --rm --network none opengym-api:plugin-0.3.0 node --test plugin/test/agent-service.test.js plugin/test/plugin.test.js plugin/test/api-integration.test.js
node scripts/verify-private-plugin.mjs
```

Docker 覆盖构建使用 `api/plugin/Dockerfile.dockerignore`，仅传入指定源码与已按 lockfile 安装的纯 JS 插件依赖，不传入 `.env`、账户数据或其他项目目录。构建前必须执行上面的 npm ci。默认上游 API 镜像没有 Plugin，启用仍需 `PLUGIN_ENABLED=1`。

专项覆盖实际 API 启动、OAuth/MCP HTTP、新旧授权范围、日程优先级、时区、单侧次数、批量原子修改、版本撤销、背景保留、逐组导入/纠错/删除、手机同步删除戳、自定义动作账户隔离、统计与缺失值，以及重复保存、摘要篡改和并发冲突。

旧 stdio MCP 测试的演示夹具按本地时钟判断是否已完成当天训练；用 UTC 跑其固定 UTC 时间测试。在台北时区直接跑时，原套件有四项预期不符。API 原全量测试上一次仍有 Coach 固定日期夹具导致的失败，不能声称全仓全量回归已通过。

部署、备份与回退见本机运维日志（根目录 `OPERATIONS.md`，不纳入 Git）。线上只读探针不会修改生产训练。

## 0.1.1 保存审批排查（2026-10-15）

用户在 ChatGPT 确认后，`save_plan` 的编排层返回“因 OpenAI 无法确定请求的安全状态，已拦截此工具调用”。当时本站状态仍为 revision 4、零模板，未保存成功。用户点的按钮自动发送确认聊天消息，不足以证明独立工具审批完成。原 HTTP 日志没有 JSON-RPC 方法/工具名称，无法追溯证明该特定请求是否到达服务端。此错误的 OpenAI 内部原因不可见，不能声称由 OAuth、草稿校验、工具标注或某个特定策略导致。

本次补强：

- `preview_plan` 返回服务端生成的 `confirmation_summary`，列出新增模板、真实动作名/ID、组数、目标、重量、单位、休息及逐侧标记。
- `save_plan` 必须同时传入该摘要（原样复制）、草稿 ID 和用户确认标记。摘要必须与草稿精确相符；不能用自行编造的摘要描述另一个操作。审批层现在可看到具体变更，而非只有不透明 ID。此举改善可审查性，不保证消除平台内部拦截。
- 保存继续标记为非只读、非破坏性、封闭账户操作；本人的“允许使用只读工具”配置保留，修改前询问。预览每次创建不同草稿，`idempotentHint` 修正为 false；保存同一草稿仍幂等。
- API Docker stdout 输出 `plugin.mcp` JSON 事件：`received`、`auth_denied`、`tool_denied`、`tool_started`、`tool_succeeded`、`tool_rejected`、`http_complete`。每次请求有随机关联 ID，响应头 `X-Request-ID`，业务错误也显示此 ID。日志仅含工具名、阶段、状态及分类原因；不记录 Token、完整参数、草稿 ID、账户 ID 或训练内容。保留期受既有 Docker 日志大小/轮转限制，重建容器后旧容器日志不可作为持久审计历史。

排查示例（服务器上）：

```sh
docker logs --since 20m opengym-api-1 2>&1 | jq -R 'fromjson? | select(.event == "plugin.mcp" and .tool == "save_plan")'
```

`received` 表示请求到达本站；`tool_started` 表示通过工具参数及 OAuth 范围检查并进入工具处理；`tool_succeeded` + `saved:true` 表示写入函数已成功返回。只有 `received` 或 HTTP 200 不能视为保存成功：MCP 业务错误也可通过 HTTP 200 返回。

旧草稿仅在内存，升级/重启后必须重新预览。已在 ChatGPT 管理页执行“刷新工具”。按照[官方刷新流程](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)，需在新对话中选择插件并重新验证变更后的参数；旧会话可能仍显示旧工具签名。本会话可见的旧签名尚不含摘要字段，不能把它当新版写入验收。

验证：本地四项专项测试通过，服务器 Linux 容器中三项插件测试通过；包括摘要篡改拒绝、真实 HTTP 保存/重复保存/并发冲突、OAuth/权限拒绝及日志不含敏感数据。公网工具定义包含必需的摘要字段；已安装插件的授权读取仍成功，账户/会话密钥/训练状态文件校验不变。没有在生产账户保存测试模板。平台能否在安卓新对话中完成新版真实保存，仍需用户验收，不能宣称该平台拦截已修复。
