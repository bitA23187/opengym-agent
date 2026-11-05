# OpenGym Plugin 使用建议审计与实施（2026-10-28）

后续更新：第二、三阶段及必要 App 配套现已实现，包含用户提出的可配置运动字段，详见 [v0.8.0 实施说明](PLUGIN_STRUCTURED_LOGS.md)。下文保留第一轮审计时的阶段状态。

本次审计对象为 `api/plugin` HTTP/OAuth 私有服务；`mcp/` 是另一个只读 stdio 服务。用户提供的 10 月 15–27 日记录数量及症状是报告输入，本次没有连接生产数据库核实或更改个人记录。验证使用本地合成账户和真实 HTTP/OAuth/MCP 协议。

## 现状与根因

| 建议 | 代码证据与判断 | 处理 |
|---|---|---|
| 未配置排期被当作休息 | App 的 `effectiveRoutineIds` 对空轮转返回空数组，插件原先直接使用 `rest_day=!ids.length`。选择 rotation 本身不建立 queue；历史频率不能证明配置存在 | 修复状态表达；新增正式轮转配置 |
| 未来轮转日历全休息 | queue 是浮动轮转，正常只回答今天（或未来 startsOn）的下一次训练，不把后续动作自动分配到连续日历日 | 没有具体安排的轮转日返回 unscheduled，避免推断连续训练／休息 |
| 备注没有长期上下文 | 已有 `context_notes`、重要程度、active/resolved、review_on、来源 workout ID；普通备注与重要上下文是不同数据，不应自动复制 | 复用已有机制，补历史 source_note_ids、来源回链和去重；Agent 在确认前归纳候选 |
| timezone 不兼容 | `docs/PRIVATE_PLUGIN.md` 已记载旧会话缓存 Schema 的事故和 0.3.1 修复；公开字段和业务校验已经共用 `trainingUpdateShape` | 保留可选字段及显式账户／部署默认，不另建 Schema；强化协议级回归和 CI |
| 计划版本为空 | `appendPlan` 和 `appendPlanEdit` 已记录最近十次 Agent 版本；App 或更早版本创建的模板没有自动历史 | 不凭现有模板数量制造历史；把新轮转状态纳入快照和冲突检查 |
| 增量会话 | 只有完整已完成训练导入和按索引 patch，没有正在进行的 Agent 会话或稳定 set ID | 第二阶段单独做，需要活动会话、App 编辑和冲突策略 |
| Rest-Pause | App 已有原生 restpause/clusters 与容量计算，插件原先仅接受 straight/dropset | 本轮开放原生模型，不新增第二套存储格式 |
| 分段动作、有氧距离、攀岩 | 现有三种日志模式无法完整表达这些语义；只加 JSON 字段无法保证 App 展示与统计 | 第二阶段设计活动／组模型，配套 App 与统计规则 |
| 食品库与食物明细 | 已有独立饮食权限、整餐、来源、未知营养素和日期；尚无完整 Food/Serving/MealItem 链路 | 第三阶段增量食品库，保留整餐历史和未知值；实际时间与逻辑日分开 |
| 返回体积 | 版本 summary 保存完整确认文字，读取时原样返回；汇总有逐次观察及每条训练心率信息 | 新增 detail_level 和版本 ID 精确读取 |
| 重复保存／预览确认 | 草稿已有账户与授权绑定、15 分钟有效期、revision/wid 锁和重复提交结果；训练和饮食已有账户明确选择的直接保存权限 | 保留这些规则及现有回归，长期背景和计划仍显式确认 |
| 自定义动作可见性 | 搜索每次读账户 customEx，没有连接级目录缓存，已有账户隔离和 HTTP 用例 | 不重复开发新接口 |

## 分阶段计划及本轮结果

### 第一阶段：可靠性与上下文（本轮完成）

1. 增加共享纯函数 `scheduleStatus`：configured/unconfigured 与原因。会话区分 training、rest、unconfigured、unscheduled；显式日期休息仍为 rest。备注不等于正式训练。
2. `preview_plan_edit.schedule` 一次预览配置 rotation 或切换 week，可组合 set_weekday / set_date。schedule 先执行，再执行 operations，再执行 routine_edits。所有 ID 和日期校验后才生成草稿；保存仍显式确认。
3. 轮转复用 App 的 saveRotation/stopPass，保存原生 rotation/queue；配置会新建一轮，starts_on 定义归属起点，日期匹配规则与 App 相同。训练导入完成一轮后使用 App 的 refillAfter 继续下一轮。修正和撤销训练不倒转已推进的轮转。
4. 计划快照包含 scheduleMode/rotation/queue，后续队列变化阻止旧版本覆盖。旧快照仅在没有轮转数据时允许撤销，避免擦除后来配置的轮转。
5. `context_notes.source_note_ids` 接收 get_training_notes 的历史 ID，校验本账户来源；历史备注返回 promoted_context_ids。新上下文按规范化文字或重叠来源去重，重复时要求更新已有 ID。解决／删除／复查日期沿用原接口；不会从时间经过自动推断康复。
6. 工具业务错误和 SDK 参数校验错误返回 JSON 信封：error_code、request_id、retryable、schema_version、stage、message、details。SDK 在回调前拒绝的参数错误也通过 transport.send 统一，并记入请求日志。保留 OAuth challenge。存储错误不暴露文件路径或原始错误内容。
7. CI 新增 private-plugin job，安装 API／插件 lockfile 依赖并运行完整插件测试（包含 OAuth/MCP HTTP）。主机在请求到本站之前的批准拦截，服务端仍无法观察；不能把这些拦截误报成服务器拒绝。

### 第二阶段：训练表达能力（本轮完成原生 Rest-Pause，其余待实现）

插件接受 `type=restpause`、`clusters=[{reps,rest_seconds}]`，包含第一段；顶层 reps 必须等于所有段次数之和。转换为 App 已有 `{type:'restpause',r:总次数,clusters:[{r,restSec}]}`。左右侧分别保存，始终保持一条工作组，不把分段再次加到容量。预览展示每段及暂停，逐组读取返回原始 clusters。局部修改总次数导致分段不一致时拒绝，改分段需完整替换该训练。重复检测比较 clusters。

下一步实现增量训练会话：独立 session_id／entry_id／set_id、客户端幂等键、预期版本号、进行中与完成状态。应先覆盖 App 同步、离线冲突与重试，再扩展 rep_segments、重量来源和有氧／攀岩活动类型。不能把尚未完成的活动保存为完整 Workout，也不能用虚构组次填充攀岩。

### 第三阶段：食品明细与调用成本（本轮完成读取精简，其余待实现）

- `get_training_versions` / `get_plan_versions` 默认 compact（摘要上限 180 字符），standard 上限 600 字符，full 保留完整摘要；version_id 选择单条。截断时 summary_truncated=true；撤销能力完全由服务端计算，不依赖截断内容。快照不通过读取暴露。
- `get_training_summary` 保持 standard 默认的兼容行为；compact 删除逐次 observations、重复的每条心率明细，保留总计、每动作统计、证据 workout IDs 和全局重要背景；full 当前等同 standard。精确逐组数据继续使用 get_training_workout。
- `get_training_notes` standard 默认保留全文，compact 每条检索文本最多 180 字符，标明 text_truncated；全局重要上下文始终完整返回，分页／搜索保持不变。
- Food/Serving/MealItem 与 eaten_at/log_date 尚未实现；应在独立修改中确定标签优先级、生熟单位及历史餐食兼容，避免强制迁移或自动补齐未知营养素。

## Schema、存储、App 兼容及回滚

没有数据库迁移、数据回填或新增依赖。状态仍为既有 JSON 文件，新增数据仅为 trainingNotes 的 source_note_ids 和计划版本快照的轮转字段。轮转与 Rest-Pause 存储完全采用现有 App 格式；旧 App 不认识的上下文字段由既有服务器扩展字段保护保留。本轮没有新增 App 页面，旧 App 的空排期文案仍维持原样；插件返回的状态已能明确说明原因。

上线前备份 state 文件和当前镜像；重启会使内存草稿失效，须重新预览。回滚源码／镜像不需要删除新增 JSON 字段，旧服务会继续读原生 queue/clusters；新格式计划版本可能在旧版本中无法撤销，但不会自动应用。回滚期间避免通过旧版本撤销新快照，重新升级后再操作。不得为回滚覆盖上线后的新训练数据。

本轮只修改源码，未部署生产服务、刷新客户端工具缓存、操作真实用户数据或验证实体手机。服务端协议测试通过不等于 ChatGPT 新会话和手机已验收。

## 验证

- 私有插件全部测试：`npm test --prefix api/plugin`，包含真实 HTTP/OAuth 的 tools/list、timezone 可选兼容、轮转预览／保存、上下文提升、Rest-Pause 保存／读取、compact/full 版本、Schema／授权／冲突错误及请求编号。
- 共享 App 函数测试：schedule-status、rotation、queue、workout-model、session-edit、dumbbells。
- 保留原有递减组、每只哑铃负重、单侧次数、权限隔离、过期预览、并发修改、重复提交、旧客户端同步和撤销回归。
