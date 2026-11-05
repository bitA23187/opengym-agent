# 上游 v1.4.4 与定制版对照

检查日期：2026-11-05（Asia/Taipei）。结论：继续选择性移植；先补安全和数据正确性修复，再引入适合训练后分析的统计功能。暂不整仓合并，也不直接替换成官方 API 镜像。

## 对照范围与证据

- 最新正式版：[v1.4.4，2026-11-03](https://github.com/DuarteSantos8/openGym/releases/tag/v1.4.4)，解析后的提交 `5f5832db56080837b58342ff50f78631dcc63e07`。
- 同时检查了抓取时的 `upstream/main`：`8fb98b168`，比正式版多 11 个可达提交，包含安全依赖升级、多周计划的周数时钟修复、登录限流与测试稳定性修复、文档等。不要将这些算作已发布的 v1.4.4 功能。
- 本地：`codex/opengym-work`，HEAD `bca49d3537da430201870c96faef08db7f8580d7`；基础版本 v1.4.1，`464355ef43d4c8f8a4e0bb6db9c2af7f240593b5`。API/前端 package version 仍为 1.4.1，私人 Plugin 源码版本为 0.8.3。
- 比较包含未提交的营养与睡眠界面改动；检查期间工作区还在产生其他 QA 文件，均未覆盖。
- 本地曾选择性采用 v1.4.2 的账号删除、浏览器/设备会话类型区分；详见 [此前评审](UPSTREAM_1_4_2_REVIEW.md)。这不表示已采用 v1.4.2 的全部安全补丁。
- 使用实际 Git 源码与 lockfile 对照，并对部分候选补丁执行 `git apply --check`。本次只做评审及只读依赖审计，没有合并代码、升级依赖、构建或部署；补丁可应用不等于功能回归通过。

相对共同基线，上游到 v1.4.4 修改 2,729 个文件，本地 HEAD 修改 299 个，其中 83 个文件两边都改过。数量包括动作目录、翻译和资源，不能当作业务功能数量；但 `server.js`、同步库、Store、Home、Stats、iOS 工程均重叠，整仓升级需要实质适配。

## 1. 上游更新了什么

发行说明：[v1.4.2](https://github.com/DuarteSantos8/openGym/releases/tag/v1.4.2)、[v1.4.3](https://github.com/DuarteSantos8/openGym/releases/tag/v1.4.3)、[v1.4.4](https://github.com/DuarteSantos8/openGym/releases/tag/v1.4.4)。

| 版本 | 主要变化 |
|---|---|
| v1.4.2，10 月 23 日 | iPhone App Store、Apple Watch 实时训练、锁屏操作与 Widgets、Apple Health 写入；账号自助删除；后台保存与持久化改进；多项鉴权、请求来源、推送、提醒计算与管理员权限修复。 |
| v1.4.3，10 月 26 日 | 修复旧 iOS 启动；CSV 导出及回导；读取健康平台的体重和逐组心率；器械真实重量档位；动作别名；相对体重力量、体重变化速度和疲劳详情；历史/首页性能；手机配对再次核验身份。 |
| v1.4.4，11 月 3 日 | Modules 总开关与预设、Integrations 页面和自托管 Webhook；全局视觉整理及 Stats 分区；逐组对比、逐组备注、肌群周组数、力量等级、周/月回顾；多周计划、自动/自定义热身、按健身房保存器材、动作合并、单动作 kg/lb、多次称重；Wear OS beta、Zepp OS；语音提示、动作录像、分享和导入扩展。 |

补充边界：

- v1.4.4 吸收了原计划放在 v1.4.5 的工作，因此提交标题里的“1.4.5”不代表该功能尚未发布；以 v1.4.4 的最终树为准。
- Google Play 是封闭测试；F-Droid 是构建与上架准备；Garmin 有代码和规划，但商店及手机桥接仍有后续工作，不能说已完整上线。
- Modules 不只是隐藏菜单，还会暂停健康同步、手表、Webhook 或 Coach 工作；需要接入本地实现才有完整意义。

## 2. 和咱们的区别

| 范围 | 上游 | 咱们目前 |
|---|---|---|
| 核心路径 | App/手表中开练、逐组操作，内置 Coach 辅助 | 训练后通过 ChatGPT 补录，也支持助手增量训练会话；可以继续用 Apple 的体能训练采集健康数据 |
| AI 接入 | 内置 Coach；上游 MCP 主要是本地只读桥 | 自有 OAuth/MCP 服务，按账号和 scope 读取、预览及保存计划、实际训练、身体指标、营养与备注；包含修订、幂等和撤销 |
| 健康 | Apple Health/Health Connect 的训练、体重、逐组心率与实时训练集成 | 独立的训练心率关联、睡眠分期、静息心率/HRV、日常健康增量上传；iPhone 原生同步与独立 Watch 凭证/上传 |
| 手表 | 训练控制器，围绕 App 的实时会话 | 独立绑定服务器和上传健康数据；目的不同，不能用上游 Watch 工程覆盖 |
| 饮食 | 检查的上游版本没有咱们这套营养/食品库实现 | 食品标签和份量、历史快照、餐次、逻辑饮食日、缺失值规则、Agent 保存策略 |
| 运动记录 | 力量、计时、有氧流程更加完整 | 另有攀岩路线、21 响等分段次数、距离/精确时间/坡度段、自定义字段及来源信息 |
| 统计与体验 | 肌群目标、相对力量、回顾及新版 Stats 更丰富 | 睡眠、恢复、饮食和结构化活动的展示更多；基础训练统计仍主要沿用旧版 |
| 动作身份 | 内置动作别名、动作合并及跨设备重定向 | 自定义动作别名、归档、引用保护与重复检查；尚无上游整套合并功能 |

本地源码证据：[结构化记录](PLUGIN_STRUCTURED_LOGS.md)、[营养与日常健康](NUTRITION_DAILY_HEALTH.md)、[原生健康同步](HEALTHKIT_NATIVE_SYNC.md)、[Plugin 能力与保存策略](PLUGIN_CAPABILITIES.md)。这些资料包含历史章节，判断当前行为时同时核对了实现。

## 3. 建议直接跟进的修复

这里的“直接”指沿用上游实现及相应测试，不重新设计；仍须在隔离分支回归。

| 优先级 | 更新 | 本地判断及移植方式 |
|---|---|---|
| P0 | API base 限制在同源 | 本地 `app-base.js` 仍是旧逻辑；防止特殊路径把请求指向其他主机。[0494ff666](https://github.com/DuarteSantos8/openGym/commit/0494ff666a250b55f2a9c1bcb37161e8ce652eca)，实现及测试的补丁检查通过。 |
| P0 | 推送订阅账号归属校验 | 本地仍按 endpoint 直接改归属；跟进校验密钥的实现。[bb46f5020](https://github.com/DuarteSantos8/openGym/commit/bb46f50201b5e290e86fa868c5488d970b0914d0)，代码补丁检查通过。 |
| P0 | 推送 URL/密钥长度限制和启动清理 | 本地缺少新上限；避免异常订阅持续放大 db.json。[4ae1cbc10](https://github.com/DuarteSantos8/openGym/commit/4ae1cbc108c7a884a89efc88f934dae8934ef113)，代码补丁检查通过。 |
| P0 | 推送地址的 IPv6 内嵌 IPv4 检查 | 本地缺少 NAT64/6to4 等后续检查。[a19f1fc16](https://github.com/DuarteSantos8/openGym/commit/a19f1fc16104536ecf8f455405adc5e07c56eba9)，代码补丁检查通过。 |
| P0 | 提醒队列性能修复 | 本地 `api/queue.js` 与 v1.4.1 相同。采用 [269c3d97c](https://github.com/DuarteSantos8/openGym/commit/269c3d97c) 的线性计算及 [0817ac5f9](https://github.com/DuarteSantos8/openGym/commit/0817ac5f91ef87685e0a3b6503240f1133059aeb) 的缓存；完整 queue 文件差异检查通过，不能只拣后一个提交而漏掉前置改动。 |
| P0 | 依赖安全修补 | 参见下节；三个依赖目录都要覆盖，不能直接拿上游整份 lockfile 替换。 |
| P1 | 无变化保存不推进训练编辑时间 | 避免三设备合并时将已删除的训练重新带回。[68a523f57](https://github.com/DuarteSantos8/openGym/commit/68a523f57434220cf13d159bac7398c850f8c0ee)，代码补丁检查通过；保留本地营养/食品的同步分支。 |
| P1 | 助力器械的 1RM 过滤 | 本地尚未识别所有 entry.target.assisted 情况。[863854a07](https://github.com/DuarteSantos8/openGym/commit/863854a0761f9c206693e66775f408804dcb05ab)，实现及测试的补丁检查通过。 |

同一安全批次中，下面两项也应优先补，但必须适配本地接口：

- Passkey 登录来源与 JSON 请求校验：[eaf22ab84](https://github.com/DuarteSantos8/openGym/commit/eaf22ab84c1641d1c5ccda2bd1b7967e7274b604)。本地已修改会话 token 类型和 Plugin 路由，移植时保留这些逻辑，验证浏览器、配对手机及 OAuth 路径。
- 手机配对要求再次证明身份：[de52c43f1](https://github.com/DuarteSantos8/openGym/commit/de52c43f1d0bdf2e5e5559b0cf2fc4f979779e2d)。本地创建配对码仍只检查现有 session；服务端补丁不能直接套用，而且必须连同前端 Passkeys/Settings 与接口文档一起改。

其余 v1.4.2 安全批次（提醒限流、停用账号、请求路径、Owner/Admin 等）应一并核对。账号删除已移植，不能据此认定整个安全批次已完成。

### 依赖审计的实际结果

执行 `npm audit --omit=dev --json`，没有执行自动修复。依赖告警表示版本命中公告，不代表所有漏洞都能通过当前运行路径利用；未检查线上容器实际依赖树。

| 范围 | 本地关键版本 | 上游对应修补 |
|---|---|---|
| API | body-parser 2.3.0、fast-uri 3.1.8、qs 6.16.0、zod 4.4.3、@hono/node-server 2.1.0 | v1.4.4 中前四项为 2.4.0、3.1.9、6.16.1、4.6.7；main 将 Hono 升至 2.1.6 |
| 上游式只读 MCP | body-parser 2.3.0、fast-uri 3.1.8、qs 6.16.0、zod 3.25.76、Hono 2.0.12 | 同上，但本地 Zod 跨主版本，需要接口验证 |
| 私人 Plugin | body-parser 2.3.0、fast-uri 3.1.8、zod 3.25.76；qs 已为 6.16.1，Hono 已为 2.1.5 | 前三项仍命中审计。Hono 2.1.5 未命中本次公告范围，不应误报为同一漏洞 |

审计总计：API 7 个、MCP 6 个、私人 Plugin 3 个依赖节点告警；这是各自树的统计，不能相加当作独立漏洞数量。私人 Plugin 为 2 high、1 moderate。

尤其不能对 Zod 3 直接执行无审阅的 `npm audit fix --force`：审计建议到 4.6.7，涉及主版本和严格 schema 行为；需要验证全部 Plugin 工具、错误返回及 MCP SDK 兼容性。

来源：[body-parser 公告](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[Zod 公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[Hono 公告](https://github.com/advisories/GHSA-rmxm-3fg6-px4f)、[main 的 Hono 修补](https://github.com/DuarteSantos8/openGym/commit/f0d4526b7dff18a52697e756a24491a4c71853a5)。

## 4. 值得采用的功能

| 建议顺序 | 功能 | 理由及适配点 |
|---|---|---|
| 第一批 | 每周各肌群工作组数/目标区间 | 很适合训练后检查，能复用 `muscle-targets.js` 和 WeeklySets。保留排除攀岩、自定义活动及非普通力量证据的规则；范围是可调参考，不是个人训练处方。可后续接入 Plugin 汇总。 |
| 第一批 | 历史逐组与上次对比 | 复用 `set-trend.js`，有明确组次对应和历史时间边界；优先放在 History，补录路径也能受益。新增结构化活动需明确跳过或采用其自己的指标。 |
| 第一批 | 每组备注 | 上游 `sets[].note`、显示及 CSV/MCP 输出可复用。咱们 Plugin 当前有整次/动作备注，但 setShape 和 set_edits 尚不接受该字段，需补齐预览、保存、读取、纠错与撤销。仅搬界面不完整。 |
| 第一批 | 动作肌群资料纠错 | 包括划船误计入胸/三头，以及 668 个动作的主肌群归类。保留 ID，重建派生资源；升级前后对比肌群统计，说明历史数据会按新归类重新计算。 |
| 第二批 | 相对体重力量、体重变化速度、周/月回顾 | 对训练后复盘有用，尽量复用纯函数；缺体重/时间的数据保持缺失。力量等级可作为可选参考，优先级低于用户自己的历史趋势。 |
| 第二批 | CSV 导出/回导及导入纠错 | 通用部分很实用；咱们额外的攀岩、分段次数、自定义字段、食品和健康数据不在上游格式中，不能宣称一次 CSV 就能完整备份全部定制数据。 |
| 第二批 | Stats 分区、搜索、日期输入和可读性 | 可参考上游布局，保留本地睡眠/营养/健康入口与正在修改的图表；不直接覆盖整个 Stats/index.css。 |

UI 功能移植属于后续实施，需遵循视觉相关技能；本次没有创建或修改界面。

## 5. 暂不照搬的部分

- **整套实时训练 Watch、Wear OS/Zepp/Garmin**：与本地“Apple 体能训练采集＋健康上传”的目标不同，不替换独立 Watch 工程。若以后明确需要手表逐组训练，再单独集成。
- **内置 Coach 的大扩展**：中途调训练、编写 Programme 等有用，但目前主要由 ChatGPT Plugin 承担；不先维护第二套写入流程。
- **Modules 全套**：值得借用“减少首页和设置负担”的思路，但需把本地营养、日常健康、NativeHealthSync 和独立 Watch 的启停接进去；原版开关无法自动控制咱们扩展。
- **一天多次称重**：上游仍保留按日的 `w`，另加 `ins/gone` 等记录。咱们 `api/plugin/body-metrics.js` 当前写入是移除当天记录后重建 `{d,w,t}`，原样组合会丢掉当天细分读数；须先改 Plugin 和同步协议。
- **动作合并**：必须把本地 `trainingLogs`、重要背景的关联动作、归档/别名、自定义字段及版本快照纳入处理；仅搬上游 `exMerged` 不完整。
- **单动作 kg/lb、器材分场馆、Programme**：会触及 Plugin 当前按账号单位写入、计划编辑、重量档位及撤销的约定；适合第二阶段适配，不属于孤立 UI 功能。
- **健康写入、手表实时采样**：上游和本地都可能操作健康数据，必须先划清数据生产者、样本去重、训练匹配和删除语义，防止重复训练/体重记录。
- **Capacitor 8 及整个原生工程**：本地仍为 7.x，iPhone 健康桥接、后台同步、签名与独立 Watch 均有定制；另开原生升级任务，不随统计功能一起替换。
- **节日、徽章、NFC、语音、录像及多平台发布**：目前收益低于可靠记录和复盘，按实际需求再选。

## 推荐实施顺序

1. 独立修补分支：安全、依赖、队列、同步空保存和助力器械 1RM。按上游各补丁配套测试验证，并覆盖本地双账号/OAuth/旧手机回写、营养与结构化数据保留。
2. 训练后分析：周肌群组数、历史逐组比较、每组备注、动作资料纠错，再做 CSV 与轻量统计布局。
3. 协议或平台项目：多次称重、动作合并、Modules、单动作单位和原生依赖升级分别处理。

延续 [现有升级说明](PLUGIN_UPGRADES.md)：固定已验证镜像，保留本地服务端扩展；直接拉取官方镜像不能保留咱们的 OAuth/MCP、健康、营养、结构化状态及扩展字段保护。
