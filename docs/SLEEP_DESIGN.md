# 睡眠同步与分期展示设计

设计起于 2026-10-24。睡眠分期、7/30 天概览和原生同步现已实现；当前使用与验收边界见 [原生同步说明](HEALTHKIT_NATIVE_SYNC.md)。下文保留设计依据与实施顺序，阶段性状态不代表当前部署状态。

## 现状与问题定位

`build-daily-health-shortcut.py` 每次读取最近 8 天、顺序处理 RHR / HRV / Sleep。
每条样本逐项读取 start/end/value/source，格式化日期、构造字典再转 JSON；睡眠分段多时动作开销累积。
v3 曾把增长中的列表作为 Repeat 输出，形成平方规模中间结果；v4 已修复，不能把它当作当前仍存在的根因。
历史真机反馈睡眠未请求上传；当前生产是否已有分期样本，需要用户账号导出或真机上传核实。

API 已保留开始、结束、阶段、来源，不是只有总时长。缺口在 dailyHealthSummary：之前只返回时长，前端只画趋势。
本轮新增 stageMinutes（当天所有会话）和 timeline（主要睡眠会话），不改上传协议、不推算缺失阶段。
时间轴采用清醒、REM、核心、深睡、未分期五行，支持醒来日期切换和时间区间提示。
保留总时长趋势。卧床不计入睡眠；同日仍沿用现有单来源选择规则（睡着时长最多）。
通用 asleep 包络让位于具体分期；冲突的具体分期归入未分期，不重复相加。
清醒仅统计所选会话起止之间的记录，不能据此视作整夜所有清醒时间。时间轴留白代表没有记录。

## 可复用方案

| 方案 | 已查到的实现 | 对 OpenGym 的意义 |
| --- | --- | --- |
| 原生同步客户端 | [PulsHealth](https://github.com/PulsHealth/pulshealth)，Apache-2.0；iOS App、Swift package、服务端及自托管栈 | 最值得深入评估；参考增量游标、持久队列、ACK 后推进游标。协议不同，不能把 OpenGym 地址直接填入就视作兼容 |
| 较小的原生导出器 | [health-dashboard-export](https://github.com/baccula/health-dashboard-export)；可配置 API、配对、增量/全量、BGTaskScheduler | 适合参考客户端结构；需核对许可证、API 载荷和后台真机行为再移植 |
| 现成导出 App + 开源接收器 | [apple-health-ingester](https://github.com/irvinlim/apple-health-ingester) 接收 Health Auto Export 的 REST 导出 | 接收器开源不等于手机 App 开源；接入前需拿真实睡眠 payload，确认原始阶段而非只有每日合计，并实现认证及格式适配 |
| 苹果式图表 | [SleepChartKit](https://github.com/DanielJamesTronca/SleepChartKit)，MIT | 有分阶段时间轴、阶段图例和时长汇总，但属于 SwiftUI，不能直接 import 到 React；本轮网页实现借鉴信息结构，没有复制源码 |
| 官方图表范例 | [Swift-Charts-Examples](https://github.com/jordibruin/Swift-Charts-Examples) | 包含 sleep stages chart，可作为原生端参考 |

## 建议路径

长期优先原生 HealthKit 同步，不继续把大量健康样本序列化堆在快捷指令动作中。
OpenGym 已使用 Capacitor，可评估增加原生 iOS 插件，或独立轻量同步 App；本轮未创建未验证的原生壳。

实现顺序：
1. HKObserverQuery 收变更通知，HKAnchoredObjectQuery 读取新增与删除；保留 UUID、sourceRevision、设备、原始类别和绝对时间。
2. 批次写入持久本地队列；网络重试使用退避；服务端幂等接收，成功后才推进对应类型的持久游标。
3. UUID 删除需要服务端墓碑/删除协议。当前按 start/end/source/category 去重不等于支持 HealthKit 删除镜像。
4. 初次回填分日/分批，后续只传增量；前台恢复时补偿；界面显示最后成功时间、待传数量与错误。
5. 后台调度是尽力而为，不能承诺固定时间或锁屏实时读取；保留前台手动补传。

短期保留 v4 作为手动兜底。若优化快捷指令，日常窗口可缩短为最近 2–3 天，历史回填独立入口；
但需明确更早的修正可能漏传，不能仅凭一个时间戳模拟真正 HealthKit 增量游标。
不恢复平行列批量提取：空 Source 曾使列错位。任何新快捷指令先用大量样本、空来源与中文类别真机验收。

官方依据：
- [Reading data from HealthKit](https://developer.apple.com/documentation/healthkit/reading-data-from-healthkit)：observer 通知与 anchored 查询各自职责。
- [Executing anchored object queries](https://developer.apple.com/documentation/healthkit/executing-anchored-object-queries)：以 anchor 获取变更。
- [Sleep categories](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)：睡眠类别定义。

## 本轮验证范围

API 14 项测试通过，包括 HTTP 权限隔离、跨午夜、来源去重、通用包络与具体阶段重叠、清醒间隙、分期冲突。
前端 4 项测试通过，包括账号切换隔离、日期切换、时间轴和旧数据回退；Vite 生产构建通过。
未进行浏览器视觉验收、真机读取、第三方 App 接入或生产部署。未使用 computer use。

## 后续实现（2026-10-24）

已按上述原生路线接入现有 OpenGym iOS 工程，而非新建独立 App。新增 UUID 增量/删除接口、持久批次、ACK 后提交 anchor、后台 observer/刷新、原生同步设置及账号切换清理。
图表本轮已从“仅借鉴信息结构”进一步改为基于 SleepChartKit 固定 commit 的 React/SVG 移植，保留完整 MIT 许可。
实现细节、构建方式和未完成的 iOS 真机验收见 [原生同步说明](HEALTHKIT_NATIVE_SYNC.md)。前面的“本轮未创建原生壳/未复制源码”记录属于初次调研状态，由本节更新。

## 7 天 / 30 天睡眠概览（2026-10-24）

参考 [Apple 官方睡眠历史说明](https://support.apple.com/en-gb/108906) 的 D/W/M 切换和 Stages / Amounts 信息结构。
图形结构核对了公开的 [Apple 周视图截图](https://cdn.hk01.com/di/media/images/dw/20240325/848921815836528640902186.jpeg/5gcuT1rXc1paF9l0oSdsOXcDqjOjpaK_GJa-jRiWvo0)
及 [Apple 月视图截图](https://attach.mobile01.com/attach/202211/mobile01-dde8f119a5a251723d58aa32a525d760.jpg)：
每个日期一列，以本地钟点为共同纵轴，各睡眠阶段按实际时间画色块；月视图显示更细的日期列和稀疏刻度。
这些图片仅作为布局参考，没有嵌入产品。

OpenGym 顶部以所选日期的全天总睡眠时长为主数字，包含午睡；支持 7/30 天与时长/阶段切换。
阶段视图使用新返回的 sessions 时间线显示各段睡眠；不把缺失分期的开始结束包络涂成连续睡眠。
日历缺失日期保留空列，平均数分母为有睡眠记录的日期，并显示记录覆盖天数。
点选日历列与单日分期详情联动；恢复趋势的 7/30/90 天范围独立控制心率/HRV，接口始终读取至少 30 天以支持睡眠月视图。

测试覆盖日历缺失、平均值分母、总时长与主睡眠区别、时区、跨午夜、夏令时日期及午睡时间线、7/30 切换、联动与查询窗口。
