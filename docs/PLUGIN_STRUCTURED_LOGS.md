# 结构化训练与食品档案：v0.8.0

2026-10-28。继续完成第一轮审计的第二、三阶段，并配套修改 App。服务器与网页已于 11:51:36（Asia/Taipei）部署，构建 `1.4.1+plugin-0.8.0-20261028`。原生手机安装包尚未发布；上线验证未修改真实训练或饮食。

2026-10-29 更新：当前源码已重新构建为 iOS 与 Android 安装包，并分别覆盖安装至已连接的 iPhone 13 与 PKJ110，未卸载旧版。两端 Release 编译、签名校验及启动检查通过；43 项针对性前端测试通过。此为本机设备安装，尚未公开分发；登录后的同步和真实健康数据功能仍待实际验收。构建产物与安装记录保存在本机忽略的 `artifacts/mobile/2026-10-29/`。

## 新运动是否需要改代码

通常不需要。动作实例（某个划船、某个跑步机）与记录模式分开：

- reps/time：原有力量次数／计时组；保持左右侧、每只哑铃重量、递减组与 Rest-Pause 规则。
- cardio：运动段的距离、时间和坡度。沿用原有 min，增加精确秒数和距离，不把计算速度伪装成设备测量。
- climbing：路线的难度体系、等级、尝试次数与是否完攀。路线不是力量组。
- custom：用户声明数字、文字、是／否字段，指定名称、单位、可选上下限；数字可选不汇总、合计或平均。无须为每一种运动新增 MCP Tool 或硬编码运动名称。

字段定义也可附加在现有力量／有氧／攀岩动作上。例如划船机保留 cardio 的距离和时间，再记录平均功率；跳绳可用 custom 记录绊绳次数和地面材质。自定义字段仅为数据，没有脚本、表达式求值或任意公式执行。专属图表、自动判断等级、训练负荷模型或进阶算法仍需开发，不能从任意新字段自动推导。

每个历史记录保存字段定义快照；修改当前档案的名称、单位、类型后，不重新解释旧记录。期间汇总仅在完整字段定义相同的组内合计／求均值，缺失值不补零，返回 observed/total 覆盖数。

## 增量训练

新增只读 `get_training_log`：列表默认精简，按 session_id 默认返回完整明细以恢复训练，可用 detail_level 覆盖。增量预览只返回本次操作、组与条目计数和版本，不反复嵌入整场训练；完整记录按需读取。写入继续使用 `preview_training_update` / `save_training_update`，传 `session_update`，不为每个操作增加 Tool。

```json
{
  "date": "2026-10-27",
  "timezone": "Asia/Taipei",
  "session_update": {
    "session_id": "back-20261027",
    "expected_version": 0,
    "idempotency_key": "start-20261027",
    "operations": [{ "type": "start", "name": "背部训练" }]
  }
}
```

流程：先 get_training_log 恢复上下文，再按返回的 version 预览变化；遵循该预览的确认要求保存。操作可以一次提交多个，原子验证后只增加一个 session version。

| 操作 | 数据 |
|---|---|
| start | 名称、可选模板与真实 started_at；不猜开始时间 |
| append_exercise | 稳定 entry_id 和动作 ID、日志模式；力量动作先加空条目 |
| append_set | entry_id、稳定 set_id、实际组数据 |
| update_set | entry_id、set_id、局部 fields；左右次数组必须指定 L/R |
| set_routes | 替换该条目的实际路线列表，保留稳定 route_id |
| set_observations | 替换声明字段的实际记录，保留稳定 record_id |
| set_note | 全场或 entry_id 的备注，可明确追加 |
| finish | 完成会话，才产生一条正式 Workout；可选已知 finished_at |
| cancel | 取消进行中记录；不生成 Workout，需确认 |

session_id、entry_id、set_id 和幂等键由调用方生成并保留，不能用数组位置当身份。每次变更要求 expected_version。幂等键和规范化请求摘要持久化在 trainingLogs，同键重试返回 already_applied；同键不同内容拒绝。草稿仍绑定账户与授权、15 分钟有效，过期／重启后重读再预览，不能盲目重试不同新键。完成和保存 Workout 原子进行，重试不会再次生成训练。

进行中的助手记录与设备本地 S.active 独立，不提前计入训练历史、频率、轮转完成或 PR。App 历史页可查看进行中助手记录，继续追加仍通过助手；本轮没有把手机实时力量训练界面改成远程协同编辑器。结束后的训练与 App 的历史／统计使用相同数据。完成管理的轮转会按 App 规则推进；预览披露该变化。

单侧计时 append_set 生成稳定 `<set_id>_L` / `<set_id>_R` 两行，update_set 使用实际返回 ID 分别修改。单侧次数保留一行及 sides.L/R，修改其中一侧保留另一侧。会话期间若账户 kg/lb 改变，禁止混合单位继续追加，需取消并以明确单位重新记录。每账户最多 10 个未完成会话，每会话最多 500 次请求；已关闭会话保留轻量收据与正式 Workout 引用，便于断线重试。

## 组和活动数据

- `rep_segments`: `[{portion: "lower"|"upper"|"full", reps: 7}]`，各段之和必须等于总 reps。只用于 straight 次数组，不能同时混用 dropset/restpause。局部次数保留在重复量中，但不作为普通全程动作的最大负重／估计 1RM 证据。
- `weight_source`: machine_stack、plate_per_side、per_dumbbell、total_external、bodyweight、other。它说明读数来源，不自动翻倍或换算；实际重量规则仍由 db_load、per_side 和账户单位决定。
- `value_source`: user_reported、label、device、estimated。可选，不为旧数据或缺失值补“实测”标签。
- cardio：`distance_km`、`elapsed_seconds`、`incline_segments: [{start_seconds,end_seconds,incline_percent}]`。时间和分钟同时给出必须一致；坡度段必须有序、不重叠且位于实际持续时间内。未覆盖的时段保持未知。读取单独返回 `derived_average_speed_kmh`，与报告的 speed 分开。
- climbing：`routes: [{route_id,grade?,grading_system?,name?,attempts,completed,note?}]`。不保存虚假的 3×1 组，不产生力量容量、肌群组数或 1RM。
- custom：自定义动作 metadata 的 `field_definitions`，训练输入 `observations: [{record_id,values:{key:value}}]`；服务端验证声明、类型和上下限。原始记录与 definition 快照放在 entry.measurements，读取返回可选合计／均值。普通力量／有氧也可携带这些附加观测。

完整训练导入、增量会话、workout_patch 和 App 活动详情编辑使用一致的约束。workout_patch 支持 set_edits 的新增测量字段、entry_activities 的路线修正、entry_observations 的自定义观测修正。没有自动把原先备注里的距离、21 响次数或攀岩数量回填成事实；历史迁移应在读取原始资料并确认后另做。

## 食品库不是食物日记文档

食品档案存储在账户状态的 foods 中，是可复用营养参照。餐食的 items 才是实际吃下的数量。修改档案不改变过去的营养摄入，也不会把“近期常吃”或计划中的食品自动记成实际进食。

Food 包含名称、品牌、营养基准量／单位（g、ml、serving）、生重／熟重／销售状态、标签或估算来源及说明、每项营养素、可选常用 FoodServing。FoodServing 的数量必须使用同一基准单位，例如每勺 30g、每杯 250ml；不猜密度或生熟转换。

MealItem 保存稳定 item_id、可选 food_id、实际数量／单位／serving_id、食品完整快照及计算营养。未知营养素保持 null，任一项目的某营养素未知时，整餐该营养素也未知，不能把已知部分伪装为精确整餐总量。标签优先；已有标签档案不能被通用估算覆盖，应另存估算档案。

新增 `list_foods`（nutrition:read，支持搜索、归档过滤和分页）。食品创建／完整更新、归档、恢复及未使用食品的删除通过 `preview_nutrition_update.foods`，同一预览也可以用新建食品记录一餐。食品新增／更新／恢复遵循预览返回的 direct-save 授权，归档／删除仍需明确确认。被历史餐食引用的食品只能归档，不能删除。

餐食传入 `items` 时由服务端计算营养，不能同时用手填整餐总量覆盖项目之和。修改旧餐时可携带既有 food_snapshot 来保留当时标签；省略 snapshot 则引用食品当前版本。App 编辑旧餐默认保留快照。

`date` 是向后兼容的逻辑饮食日，同时保存为 log_date；`eaten_at` 是可选的实际 ISO 时间，必须包含时区偏移。例：2026-10-28 00:30 实际进食，可以归入 2026-10-27 的饮食汇总，两个值均保留。现有 date/time 的整餐记录无需迁移。

## App 配套

- 饮食页：食品库创建、编辑、归档／恢复；营养基准、来源、生熟状态、常用份量；餐食选择食品和份量、显示项目及实际进食时间，自动计算整餐营养。
- 自定义动作：选择活动类型，配置数字／文字／是或否字段、单位和汇总方式。
- 动作库：攀岩／自定义活动进入“记录活动”，避免加入普通力量模板后生成虚假的组次。
- 历史页：查看助手的进行中记录；“记录活动”创建攀岩、有氧和自定义观测。
- 训练详情：查看／编辑线路、分段次数、重量与测量来源、距离／时长／坡度、自定义字段。线路／自定义活动使用活动编辑器，不套用普通力量重复训练或模板转换。复制为文本也保留路线及自定义观测。
- 首页：没有可用排期时显示“尚未配置训练排期”，显式休息日保留休息含义。

## 存储、同步、兼容和回滚

没有 SQL 迁移、强制回填或新依赖，采用新增可选字段。foods 与 nutritionEntries 使用独立记录时间戳和删除墓碑；服务端与 App 的同步合并、重置、备份替换和仅食品档案的本地数据识别已同步扩展。trainingLogs 属于服务端助手元数据，旧客户端全量回写不能覆盖它。新客户端 PUT /api/data 声明 structured_training_v1 / food_items_v1 能力；旧客户端可以原样同步这些不认识的字段，但若编辑将擦除线路、自定义测量、食物快照或实际进食时间，服务端返回 426 client_update_required，整个写入不落盘。显式删除整条记录及账户重置仍走原有规则。

上线前保留当前镜像和账户 state 文件备份，先部署支持新字段的 API，再发布配套 App 和刷新 MCP 工具；服务仍不新增 OAuth 权限。本次已部署支持新字段的 API 和配套网页，公网工具发现已验证。正式安装包发布、真机与 ChatGPT 新会话实际读写仍待验收。

回滚时保留新增 JSON 字段和完整快照，不做字段删除迁移，不覆盖上线后的训练。旧服务无法保证丰富字段的编辑兼容，优先保留新 API 的写入保护，仅回退 App／入口；若必须回退 API，应暂时关闭相关数据写入后再恢复支持的版本。重启会使内存预览失效，但已保存的训练会话及幂等收据仍可重读恢复。

## 验证与已知基线

- HTTP 私有插件测试覆盖工具 Schema、确认权限、食品库／份量／快照／跨日、增量训练、幂等／并发、左右侧、活动与自定义字段读写。真实 native GET/PUT 测试验证旧 App 写入拒绝及新 App 保存后读取一致。
- 共享模型和组件测试覆盖食品及同步、声明字段及缺失值覆盖、局部次数的力量统计排除、线路与自定义活动编辑、原生完成和复制文本、单侧与单位转换、首页排期。
- 生产前端 build、普通 Node MCP 导入图及旧 stdio MCP 测试均验证。
- 全仓测试原有失败单独用 HEAD 的隔离副本复现：前端 8 项（旧本地化／占位符、固定演示数据、时区导出／窗口、代理配置、旧营养 UI 断言），API 11 项（Coach 的过期日期／任务与负载夹具）。未把这些无关修复混入本轮，也不宣称全仓全绿。新增 Docker COPY 校验发现的新模块遗漏已修复并通过专项测试。

专项验收结果：HTTP 插件 74 项；相关共享模型／前端回归 284 项，另自定义动作编辑 24 项；API 存储／同步及打包回归 25 项；旧 stdio MCP（UTC 固定夹具）95 项。前端生产构建及 Node 导入图通过。全量前端 5181 项通过、8 项基线失败；API 全量初次发现的 Docker COPY 遗漏已修复，其余 11 项失败在 HEAD 基线全部复现。
