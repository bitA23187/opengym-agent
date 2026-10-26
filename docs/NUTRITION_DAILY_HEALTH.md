## 2026-10-26 移除整天完成状态（v0.7.2）

本节取代下文历史完成标记规则。首页、详情、图表、日均和周均不再区分完整/尚未记完，也不再依赖旧 nutritionDays。均值按相应营养项已有数值的日期计算，包含真实零值；缺失日期和未知值不填零。某餐营养值未知时，日合计仅包含已知数值并明确说明；全天合计和分餐冲突仍拒绝累计。

插件不再暴露 completed_dates 或日级 complete 状态，不再要求 GPT 标记一天完成。为兼容缓存旧工具签名的客户端，传入的旧 completed_dates 被忽略且不保存。历史 nutritionDays 元数据只保留兼容存储，界面和统计完全不读取它。无需改写真实饮食记录。明确饮食/目标直接保存的账号偏好、异常追问和目标修改功能保留。

## 2026-10-26 饮食直接保存与目标修改

本节取代下文历史确认流程。饮食页删除手动「今日已记完」开关；用户报告全天饮食时，GPT 应在同一更新中传 `completed_dates`。单餐不能推定全天已记完，完整日均值计算规则保留。

`preview_nutrition_update` 新增 `goals`，按字段修改 calories（kcal）和 protein/carbs/fat（g）；省略保持，null 清除。只设置用户要求或同意的目标，不能将计划当实际摄入。读取仍使用 `get_nutrition`，无需新增 OAuth 权限。

`PLUGIN_NUTRITION_AUTO_SAVE_USER_IDS` 按账号启用明确摄入及目标更新的直接保存。预览返回 `authorization.requires_user_confirmation=false` 时，GPT 内部完成预览后立即用原摘要保存，成功后告知用户，无需展示预览再索取回复。其他账号及删除保留确认。有异常/歧义（份量、生熟重、单位、可疑数值等）先追问；传入非空 `review_questions` 的草稿由服务端拒绝保存，澄清后需重新预览。语义检查由 GPT 执行，空问题列表不是无异常的证明。主机工具审批、授权范围、账号/授权绑定、修订冲突和重试幂等不变。客户端缓存旧工具描述时需刷新 App 工具并新开对话。

# 饮食记录与日常健康同步

2026-10-24 02:23:41（Asia/Taipei）：已部署到生产环境，Plugin v0.7.0，最新修复于 02:45:51 上线，网页构建 `1.4.1+plugin-0.7.0-health-sync.2`。网页/API 自动化及本地浏览器验收见本次实现的测试；iPhone 健康读取仍需真机验证，签名不等于读取成功。现有训练心率快捷指令保持可用；最新修复已统一健康上传凭证，见文末。

## 饮食

首页「今日饮食」→「记一餐」；完整记录在 `#/nutrition`，统计页有入口。支持早餐、午餐、晚餐、多次加餐，及没有分餐信息时的一条全天合计。全天合计不能与分餐共存；离线合并产生重叠时提示冲突，不累加出双倍摄入。

每条记录包括日期、餐次、可选时间、食物描述、kcal、蛋白质/碳水/脂肪克数、纯酒精克数，以及数值来源（估算、营养标签、称重估算、GPT 粗估）。未知留空，0 表示确认没有；来源及食物说明用于保存生熟重、用油和份量等估算条件。

已提供 kcal 时，使用这个包含酒精的总热量；没有 kcal 时，仅在蛋白质、碳水、脂肪、酒精均已知时按 `4P + 4C + 9F + 7A` 估算，不重复加酒精。该公式是常用近似，与标签可能有纤维、糖醇和取整差异。酒精能量：[MedlinePlus](https://medlineplus.gov/ency/imagepages/17023.htm)。

每日展示已记录合计和逐项缺失状态。「今日已记完」由用户明确标记，不代表估算值精确；新增、删除、修改或移动日期会取消相关日期的完成状态。周平均仅使用已记完且该项数值完整的日期，显示参与日期数；不将漏记日按 0 计算。7/30/90 天趋势可切换各项营养素。目标由用户自行填写，不从体重或分享对话推算。

`S.nutritionEntries` 以 ID 保存独立时间戳条目，删除为 `{_ts}` tombstone；`S.nutritionDays` 以日期保存完成标记；`S.nutritionGoals` 保存可选参考值。沿用离线同步、账户 JSON/媒体备份、重置与导入；服务器 PUT 额外保护旧客户端遗漏的餐次。明确替换备份会为旧餐次产生删除标记。没有导入分享聊天中的任何真实饮食或目标。

## GPT 工具与授权

- `get_nutrition`：1–366 天记录、逐日合计、完成情况和目标，需要 `nutrition:read`。
- `preview_nutrition_update`：实际吃过的餐次、修改、删除、记完日期，需要 `nutrition:read` / `nutrition:write`。建议吃、准备吃和假设吃过的内容不能作为实际摄入。必须明确本地日期、IANA 时区和来源，不补造未知营养素。
- `save_nutrition_update`：仅保存已明确确认的同一账号/授权、15 分钟有效、原修订版本的草稿；复制完整 `confirmation_summary`。重试幂等。训练记录的直接保存偏好不适用于饮食。
- 修改需先读到原餐次，传完整替换记录；删除传 `delete_ids`；`completed_dates` 只标记实际已记录且无冲突的日期。
- `get_daily_health`：读取日常健康趋势，独立 `health:read`，范围 1–366 天，显式 IANA 时区。

旧 OAuth grant 不会自动获得新权限。部署后需要重新连接并同意所需权限，新工具发现也需在 ChatGPT 端验收。

## 日常健康

首页 Apple 健康同步卡片或统计页 →「睡眠与恢复」(`#/daily-health`)。网页读取服务器趋势、管理统一上传凭证、下载/启动快捷指令、导出和删除数据。网页本身不直接读取 iPhone 健康。

- 静息心率：读取独立 `restingHeartRate`，bpm，展示每天最新样本及样本数，不用训练最低心率替代。
- HRV：`heartRateVariabilitySDNN`，ms，保留样本时间、来源、SDNN 方法；展示每日中位数及样本数，不与 RMSSD 混用。
- 睡眠：保留 start/end/category/source。卧床及清醒不计入睡眠时长，同来源重叠 asleep 区间仅计一次。每个来源按不超过 3 小时的间隔组成睡眠段，按整段醒来日期归属；同日选实际睡眠覆盖最长的一个来源，展示来源并列出其他来源，避免多设备重复相加。主睡眠与额外睡眠段分开计算；这是明确的 MVP 聚合规则，不承诺逐日与 Apple 健康 UI 完全一致。

参考：[Apple 静息心率](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/restingheartrate)、[Apple HRV SDNN](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn)、[Apple 睡眠类别](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)。不生成恢复分数、不推断医疗结论或自动改训练计划。

### 接口

网页登录态/配对会话：

- `GET/POST/DELETE /api/daily-health/connection`：查询状态、创建或替换、撤销统一健康上传凭证。长期有效，可手动撤销或替换，仅 POST 返回一次明文；旧接口作为别名保留。替换或撤销统一影响训练与日常健康的全部旧凭证。
- `GET /api/daily-health?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Asia/Taipei`：1–366 天摘要。
- `GET /api/daily-health/export`：原始全部日常指标 JSON。
- `DELETE /api/daily-health`：删除已存日常指标，凭证仍有效，再次同步会补回；需要停止同步时同时撤销凭证。

`POST /api/daily-health/import` 与训练心率共用 `Authorization: Bearer ogh_…`；已创建的 `ogh_` / `ogd_` 凭证都继续可用，无需迁移写入。网页登录态不能替代上传凭证。凭证只能上传，不能读取、导出或删除数据。示意请求：

```json
{
  "metric": "hrv",
  "unit": "ms",
  "timezone": "Asia/Taipei",
  "start": "2026-10-22T00:00:00+08:00",
  "end": "2026-10-24T00:00:00+08:00",
  "samples": [
    {"start": "2026-10-23T07:00:00+08:00", "end": "2026-10-23T07:01:00+08:00", "value": 50, "source": "Example Watch"}
  ]
}
```

此示例仅供格式说明。metric 为 `restingHeartRate` / `hrv` / `sleep`；静息心率单位 bpm，HRV 单位 ms。睡眠传 category=`inBed/awake/asleepUnspecified/asleepCore/asleepDeep/asleepREM`，区间必须有正时长。也接受严格对应的数组或换行文本列 `dates/ends/values/sources`；来源列省略时标为 Apple Health，无法保证每条来自 Apple Watch。所有时间必须带时区，查询最多 32 天，每次最多 20000 条，每指标最多 250000 条。

窗口筛选按重叠处理，跨边界样本保留原始起止时间；完全在窗口外的样本跳过并返回数量，不再让整批失败。当天静息心率的按日报告区间允许结束于次日零点，仍拒绝未来开始时间、倒置和超长区间。默认按 metric/start/end/source/category 去重并补齐，同键新数值覆盖旧值。没有样本的读取不会清空历史。高级调用可显式 `replace_window: true` 用非空批次替换窗口；不会自动镜像 Health 的样本删除，修正来源或区间后必要时导出、清理并重新同步。

数据存入 `DATA_DIR/daily-health/`：目录 0700、文件 0600，按账号隔离；凭证只存哈希，退出所有设备/停用账号会使凭证失效。重置或删除账号清理数据与凭证。现有服务器整目录加密备份包含该目录；应用 JSON/媒体 ZIP 不包含，需单独导出或服务器备份。

### 快捷指令与真机验收

生成器：`python3 scripts/build-daily-health-shortcut.py`，无需 Actions App。快捷指令读取最近 8 天，休息日也能执行，空指标跳过。v2 仅在结束时显示一次汇总；服务器返回某项校验错误时记录原因并继续处理后续指标。网络和系统健康权限错误仍可能由 iOS 中止。公共文件不含凭证，服务器 URL 和完整 Bearer 凭证由用户填写；两种同步填同一份凭证，长期有效，可手动撤销或替换。统一创建/替换/撤销入口为首页 Apple 健康同步的“同步设置”，日常健康页不再另建凭证。

签名文件：`artifacts/shortcuts/daily-health/v3/OpenGym 日常健康同步.shortcut`，前端 public 同路径有一份。生产部署若沿用现有 shortcuts 只读挂载，还需将签名文件复制到服务器 `shortcuts/daily-health/v3/`。

真机需核对：三种健康筛选类型、HRV 的 ms 与 RHR 的 bpm、来源属性能否逐项提取、睡眠类别的实际本地化文本、日期边界、权限不足与空样本、与健康 App 对照的单日样本/睡眠时长、重复运行不增重复数据。未知类别和错误单位被服务器拒绝；不能仅凭导入/签名成功宣称通过。`--smoke` 生成无健康/网络/凭证的参数验证文件；v2 已在 macOS 原生运行无健康/网络的四分支汇总验证，确认第一项失败后继续后续指标。

## 初版验证记录

- 前端饮食、日常健康、同步合并、备份替换、重置与登录保护：111/111；已有首页/心率同步等回归组：57/57（两组部分重叠，不相加）。
- 核心 API/心率兼容/同步时间戳组：40/40；额外服务器修订/重置回归：4/4；后续新增睡眠类别防护测试也通过。
- Plugin 全套：53/53，包括真实 HTTP 权限隔离、预览确认、账户绑定、旧版本并发冲突。
- Vite 生产构建、源字符串检查、OpenAPI YAML 解析和路由覆盖检查通过；`git diff --check` 通过。
- 按用户要求由 Luna6 / Extra high effort 子代理进行本地隔离访客浏览器检查。中英文记餐、空值、编辑、跨日移动、删除、记完一天与未登录健康页面已验证；修复中文标题与营养标签翻译。
- 后端全套存在本次未改动的 Coach 测试失败；已单独复现 `payload.test.js:50`，固定的 2026-07-20 测试训练已落到当前日期的回顾窗口外。没有为这些旧测试改动 Coach 逻辑。其他语言的完整 locale 覆盖检查仍失败；本次提供英文及简体中文，其他语言缺失项沿用英文回退。
- 快捷指令已由 Apple CLI 成功签名；artifact 与 public 副本 SHA-256 均为 `1f32db82edc24c29cd0e154a9c696c51b8f3ce4cd17d75804376603c9e187aff`。签名后尚未执行健康读取，iPhone 验收项目见上。

部署前最终 Linux 镜像隔离测试 102/102。加密备份已上传，API/Web 均健康，账号/训练/凭证/健康数据摘要在切换前后完全一致。网页及签名快捷指令公网字节校验通过，未登录和错误凭证访问被拒绝。完整镜像、回退路径见 [运维记录](OPERATIONS.md)。

## 2026-10-24 修复：区间与统一凭证

用户真机反馈静息心率批次被严格区间校验拒绝，并在指标弹窗处停留。旧错误未包含具体样本，因此不能仅凭它确定是哪一条时间不匹配。已补充跨窗口、端点相等、当天静息心率日区间、错误原因的回归测试；快捷指令改为一次汇总。Apple 查询的区间重叠语义参考 [HKQueryOptions](https://developer.apple.com/documentation/healthkit/hkqueryoptions?language=objc)。新建凭证 长期有效，可手动撤销或替换，替换/撤销会使两种旧凭证同时失效；已有凭证不在部署时自动轮换或续期。

修复于 2026-10-24 02:45:51（Asia/Taipei）部署。最终 Linux 镜像 107/107，相关前端 11/11。公共 v2 签名文件 SHA-256 为 `9c0f45208a96fc13a47e76f17ef7f87ca1fb0044904bd472109fb5a2b3b39b45`。macOS 模拟运行输出保存在 `artifacts/shortcuts/daily-health/v3/native-smoke.txt`；模拟项未包含真实凭证和健康读取。

## v3：完整记录上传、长期凭证和精简界面（2026-10-24）

用户真机已确认 v2 静息心率接收 8 条、HRV 接收 91 条；睡眠出现平行列数量不一致。
v3 在 Repeat with Each 中逐条读取开始、结束、Value 和 Source，先创建字典再转换 JSON，
整体以 `samplesJson` 传入 API，避免某个属性为空时批量提取丢失行对应关系。
来源不可用明确标为 `Apple Health (source unavailable)`；类别缺失或未知仍拒绝，绝不推算睡眠。
旧平行列协议继续严格校验，错误返回四列数量并提示更新快捷指令。

现有与新建健康上传凭证均长期有效，无需轮换或重写生产数据；撤销、替换、账户停用与
退出所有设备仍使凭证失效。状态中的 `expiresAt` 和 `lifetimeDays` 均为 null。
本文前面的 v2 到期说明属于历史实现，现由本节取代。

首页 Apple 健康同步与日常健康页沿用现有控件及配色。安装和指标解释放入 ⓘ 弹层；
删除逐日样本/来源文本和日常健康页的凭证管理按钮。健康数据导出/删除收进折叠项。

语法依据：[原生 iOS Health 快捷指令导出记录](https://github.com/viticci/shortcuts-playground-plugin/blob/main/codex/skills/shortcuts-playground/HEALTHKIT.md)
列出 `Get Details of Health Sample` 的 Value/Source 属性；类别枚举参考
[Apple HKCategoryValueSleepAnalysis](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)。

页面复核使用纯虚构数据：320 / 375 / 414 / 768px iframe 视口均无横向溢出，ⓘ 说明弹层及数据折叠项正常，完成与 Esc 可关闭弹层。未执行数据导出、删除或真实健康同步。


## v4：结束重复处的规模问题（2026-10-24）

v3 的三条原生样本不足以覆盖大量睡眠分段。用户确认停留在“结束重复”，且两次运行
均只有前两项上传成功，没有睡眠上传请求。v4 删除循环内不断增长的命名列表：每轮最后
输出当前一条 JSON，直接合并 Repeat Results。避免重复收集所有增长前缀，仍保留完整
记录与来源、类别校验，不缩短查询窗口、不丢弃分段。

新增 `--serialization-smoke --sample-count 1000`，使用与正式版相同的 serialize_rows
函数，仅读取器替换成虚构字典，ISO 时间转换、字典序列化和合并逻辑完全共用。
原生最终报告 records=1000，空来源与引号/换行保留；同一测试的 CLI 运行 28.572 秒。
不代表 iPhone Health 查询的实际耗时。v4 已在 03:41:54（Asia/Taipei）上线，下载路径
`/shortcuts/daily-health/v4/OpenGym 日常健康同步.shortcut`，已有凭证继续使用。
