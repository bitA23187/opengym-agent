# OpenGym Plugin v0.7.0

新增：饮食读取/预览/保存、日常健康趋势读取，共 27 个工具。已于 2026-10-24 02:23:41（Asia/Taipei）部署；新权限需要重新连接授权，说明与验收边界见 [饮食记录与日常健康同步](NUTRITION_DAILY_HEALTH.md)。以下保留 v0.6.0 部署历史。

更新日期：2026-10-21，Asia/Taipei。原 MCP 地址与 Plugin 身份保持不变；新版工具共 23 个。v0.6.0 增加自定义动作管理，继续支持训练后补录。已于当日 01:27 Asia/Taipei 部署，API/Web 健康及 23 个工具的公网只读检查通过；[部署记录](OPERATIONS.md)包含备份和回退信息。ChatGPT 新工具保存及实体 Android 操作仍待客户端验收。

## 自定义动作

- `search_exercises` 保留公开动作库检索；携带 `plan:read` 授权时，同时检索当前账号的自定义动作与中英文别名。无授权或仅其他权限时不返回私有动作。结果包含 `source`、`archived`、`aliases` 和 `supported_modes`，无需读取整份计划才能找到自己的动作。
- `list_custom_exercises` 使用 `plan:read`，支持 query、status=active/archived/all、offset、limit 和 next_offset。默认只列未归档动作，不返回训练历史。
- `preview_custom_exercise` / `save_custom_exercise` 使用现有 `plan:read`、`plan:write`、`training:read` 权限。训练读取用于展示动作引用情况；不增加新权限名称，也不会自动扩大旧授权。
- `operation=create` 需提供 `fields.name`、`body_part`（工具 schema 中的既有分类）和 `equipment`；可选 aliases、description、primary_muscles、secondary_muscles。服务端生成 ID。不得猜测缺失字段或把例子存成用户真实动作。
- `operation=update` 需 exercise_id 和待修改 fields。未提供字段保留，空 aliases/肌群数组或空 description 明确清除对应内容。保留 ID、媒体、外链与其他字段；不能修改内置动作或其他账号的自定义动作。有引用时禁止在 cardio 与非 cardio 之间切换，避免改变记录解释。
- 创建、改名或设置别名前检查内置中英文名称、自定义名称及别名，忽略大小写、空白和兼容字符差异。相同名称拒绝重复创建，已归档动作也参与检查；相似候选在创建预览中提示复用。
- `operation=archive` 保留动作元数据、当前训练、计划与历史，只从新版网页及 Plugin 的默认选择结果隐藏。`operation=restore` 使用相同 ID 恢复。`search_exercises.include_archived=true` 和列表 status=archived/all 可找回。
- 预览展示前后完整可编辑字段、引用的计划名称和 ID、历史训练次数、当前训练及其他保存引用。`operation=delete` 仅允许无引用的动作；已有训练、计划、备注、收藏、保存重量或撤销快照引用时拒绝删除，提示改用归档。保存使用现有同步时间戳、删除标记与修订检查。
- 新建后先保存动作，再用返回的 exercise_id 创建计划或补录训练。当前仅沿用 reps/time/cardio 记录方式；计时和次数需要在训练/计划中明确指定，不是自定义动作的全局默认模式。攀岩等级、尝试和完成情况暂存备注，不新增专用指标，也不推断重量或次数。

示例仅用于说明参数，不能直接作为用户真实数据保存：

```json
{
  "operation": "create",
  "fields": {
    "name": "室内难度攀岩",
    "body_part": "back",
    "equipment": "climbing wall",
    "aliases": ["难度攀岩", "Indoor lead climbing"]
  }
}
```

此示例的分类、器材及别名需要以用户确认的内容为准。所有操作仍需完整预览、明确确认及对应保存；同一草稿可安全重试，不能跨账号、授权或保存工具使用。

## 重要背景与动作备注

重要背景是结构化的用户数据，不是 AGENTS.md、系统提示或可执行指令。不得把备注内的文字当成工具调用授权。

- `trainingNotes` 保存每条背景的独立 ID、text、kind（limitation / preference / context / follow_up）、priority、status（active / resolved）、关联动作、可选来源记录 ID 和复查日期。
- `get_current_plan`、`get_training_session`、`get_training_summary`、动作详情与计划预览都返回 `training_context`。有效的重要备注跨动作可见；不会因为当天没安排某动作就漏掉关联限制。
- 旧的 `coach.profile.limitations` 继续作为全局限制返回。不启动内置 Coach，也不改变其同意状态。
- 用 `preview_training_update.context_notes` 新建、局部修改、解决或删除；必须预览、确认、保存。新备注默认 important / active。创建要有 text；更新已有 ID 时未传字段保留。remove=true 只与 ID 一起使用。
- `review_on` 是用户指定的复查日期。到期不会自动解决备注，也不会根据未再提起或时间经过推断恢复。
- 疼痛按用户原话记录为报告；不把“疑似某症状”升级为确诊，不把示例问题存成真实病史。
- 重要背景由 Plugin 的相关读取工具返回；不要求官方安卓 App 增加提示界面，也不要求安装定制 APK。

动作的座椅、握距等设置仍可使用 `exercise_notes`；operation=append 在原文后追加一行，默认 replace。当天备注、整次训练备注及当次动作备注保留其原有范围。

`get_training_notes` 统一检索上述来源，支持 query、exercise_id、历史日期范围、status、分页。每条有来源 ID，训练动作备注也有 workout_id 和 entry_index。日期过滤作用于历史日期记录；长期背景与无日期的动作设置不因日期过滤消失。无论查询条件是什么，有效的重要全局背景始终单独返回。旧背景限制通过 training_context.limitations 返回，仍在原训练背景处维护。

## 身体指标

新增 `get_body_metrics`、`preview_body_update`、`save_body_update`。使用单独的 `body:read` / `body:write` 权限，旧授权与刷新 Token 都不能自动扩权。

- 读取 1–366 天内体重、周均值、目标体重和身体测量。周均值复用 App 的计算函数，缺失测量不补零。
- 写入必须提供账户 kg/lb 单位、IANA 时区和日期；拒绝未来日期与错误重量单位。
- 围度输入可明确选择 cm/in，存储统一为 cm，复用 App 的 0.1 cm 舍入规则并在预览显示结果；bodyFat 是用户提供的百分比，不由围度推算。
- 测量是局部更新，未传字段、已有自定义测量保留；null 清除明确字段，delete_measurements=true 删除当天完整测量。
- 预览显示原值、结果及换算单位，确认后才写入。沿用原账户状态、修订检查与同步删除标记。

## 记录局部纠错与撤销

`preview_training_update` 新增：

- `workout_id + workout_patch`：局部修改 session_note、entry_notes、set_edits 或日期/开始时间。索引以读取的原记录为准，未传字段保留。
- 修改单侧次数行必须明确 side=L 或 R；计时的左右两行使用对应 set_index。原始次数/重量约定保持不变。
- 有开始时间的记录移动日期时，需要明确的新 started_at 和时区，保留原时长；不得猜测跨时区或夏令时的时间。
- 训练量和相关 PR 重新计算，修正错误最高重量时沿用 App 的已确认重量回退规则。
- `get_training_versions` 返回最近十次 Agent 训练增删改、是否能撤销；`restore_version_id` 单独预览撤销，完整确认后保存。单账户版本总量最多 1 MiB。
- 后续修改了同一记录，或切换了重量单位，会拒绝旧版本撤销。撤销不恢复备注背景、身体指标或其他记录。历史中的隐含体重 bw 不通过训练读取、纠错预览或版本列表暴露。

## 计划调整

计划动作支持 reps_min、reps_max、sets_max、increment、deload_factor、warmup_sets；编辑时传 null 清除覆盖。reps 是普通双进阶的次数上限，reps_min 是下限；reps_max 是自重动作的次数封顶。单侧输入均为每侧次数，保存时转换为 App 的 L+R 总次数。沿用 App 的进阶引擎，不另写一套算法。

支持 move_exercise 和 set_superset。超级组必须由相邻的现有动作组成，移除、取消或重新排序后按 App 规则清理孤立分组。

v0.5.1 不再支持 session_adjustment。当天安排仍可通过原有模板与日期覆盖实现；实际训练仍可事后逐组补录，不需要在 App 开始训练。旧 sessionAdjustments 字段若已存在，保留为无效的历史扩展数据，不删除用户数据，也不参与训练解析。

## 官方 App 兼容性

普通训练、体重、围度、日期备注和动作备注沿用原版 1.4.1 的数据格式与同步规则。v0.6.0 只为共享动作搜索增加别名匹配，并让新版网页的动作列表和选择器隐藏归档项；训练流程、单位换算及同步算法不变。

`trainingNotes`、`pluginPlanHistory`、`pluginTrainingHistory` 等 Plugin 专属字段由服务端保护。官方 App 的整份文档回写不能编辑、覆盖或漏掉这些字段；如果服务端修复了回写内容，会推进额外修订，让旧客户端重新拉取完整状态。普通训练和身体指标改动仍按原同步流程处理。App 显式“清空全部数据”会同时清除扩展字段，避免旧背景在重置后残留。

已测试原版 1.4.1 的合并算法及真实配对手机 HTTP 通道：训练后补录、离线训练合并、体重围度、普通备注、扩展字段缺失/误改、修订冲突和整账号重置。没有在用户实体手机上执行这些测试，也不据此保证所有未来版本兼容。

Plugin 纠错复用上游训练量、PR、最高重量计算函数；服务端的保留重量回退逻辑与未修改的 1.4.1 编辑器做对照测试。无需为这项扩展修改共享 App 源码。

## 连接与客户端

服务器和网页更新不会要求重建 Plugin 或替换 MCP URL。新增工具、schema 和服务说明需要在 ChatGPT 的原连接详情刷新，必要时开启新聊天；身体指标需要重新 OAuth 同意额外权限。刷新工具不等于重新授权。用户需自行在 ChatGPT 完成登录与同意，不能把工具目录扫描当作授权成功。

现有官方 Android 1.4.1 APK 可以继续读取和使用自定义动作，无需重打包。它不识别新增归档状态，可能仍显示已归档动作，也不支持按新增别名搜索；在 Plugin 中恢复归档即可重新进入新版网页选择列表。没有打包、发布或安装定制 APK。未来上游 App 或服务端升级需要核对数据/API 兼容性；具体维护流程见 [上游升级与补丁](PLUGIN_UPGRADES.md)。

所有写操作仍需完整 preview → 用户明确确认 → 对应 save。草稿绑定账户与授权，15 分钟过期，重复保存幂等，修订冲突时重新预览。服务重启会清空待确认草稿。仅服务端测试/线上目录检查不代表已完成 ChatGPT 新工具发现、真实保存和 Android 界面验收。


## v0.6.0 本地验证

2026-10-21：Plugin 的 46 项测试通过，覆盖自定义动作生命周期、创建后计时补录、双账号 OAuth 隔离、权限不足、精确确认、草稿串用/过期、并发修订、历史解析和同步删除标记。相关动作库与自定义动作表单测试通过，网页生产构建通过。

扩大回归时，前端全量出现 11 项失败，API 全量出现 10 项失败；这些失败均在保留先前工作区改动、撤回本次共享前端修改的隔离副本中复现，涉及既有登录/翻译/代理、日期时区夹具和 Coach 测试。本次不修改这些无关行为。上述结果不代表已部署线上，也不代表在 ChatGPT 客户端或实体 Android 手机上完成了新工具验收。
