# iPhone 原生 HealthKit 同步

## 2026-10-26 当前实现：网页功能对齐与省电优化

iPhone 继续打包同一套 React 页面，包含当前首页、睡眠、营养记录和统计界面；健康同步使用原生 HealthKit，直接复用已登录的 HTTPS 服务器会话。首页说明为「通过 Apple 健康原生同步」，展示训练心率、睡眠与恢复、自动同步状态、上次检查和手动同步入口。下方保留历史实现记录，其中上传专用凭证和旧构建状态不代表当前流程。

- 首页移除每 5 秒的状态轮询，使用 Capacitor `healthSyncChanged` 原生事件；初次显示及恢复前台时读取状态，隐藏时忽略事件，离开组件后移除监听。重叠状态读取合并为一次后续读取。
- 启动和前台恢复共享正在执行的同步；成功后的 60 秒内重复前台回调不再发起整轮同步。真实健康数据变更不受此项限制；手动重试也不受此项限制。
- 多个 HealthKit observer 在同步过程中到达时，合并为一次补查；所有等待的 observer 在同步结束后才调用 completion。后台交付频率统一请求 hourly，降低即时唤醒频率。hourly 是系统调度请求，不保证每小时准时执行。
- 后台刷新成功后最早请求 6 小时后的机会；失败时保留指数退避，后台机会不早于 15 分钟后。没有新增或删除的健康数据页只保存本地游标，不再发空上传请求。有数据的批次仍需服务端 ACK 后推进游标，失败保留待传数据。
- 通用服务器版本检查在页面隐藏时撤销计时器，返回前台时恢复，避免隐藏页面不断重设定时器。

已完成设备版 Release 编译与签名校验、89 项针对性前端测试、Swift 调度/协议检查，以及深浅外观四种宽度的实际组件预览。全量前端测试 5,136 项通过、7 项失败；具体范围与签名 IPA 见 [本次交付说明](../artifacts/ios/2026-10-26/web-parity-health-sync/README.md)。真实健康读取、锁屏交付、实际耗电变化尚未测量。

参考：[Apple Observer Queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries)、[HKUpdateFrequency](https://developer.apple.com/documentation/healthkit/hkupdatefrequency)、[Capacitor iOS events](https://capacitorjs.com/docs/plugins/ios)。

## 历史记录

最新状态（2026-10-25，Asia/Taipei）：现有 Capacitor iOS App 已通过 Xcode 27.1 / iOS 27.1 SDK 的完整 Release 设备版编译，并生成无签名 IPA。完整模拟器版（x86_64）也编译通过；独立 arm64 验证副本已安装、启动并核对初始界面，见下文的扫码库架构限制。当前没有有效签名证书；真机安装、健康读取和后台同步验收仍待完成。

[无签名 IPA、校验值与构建记录](../artifacts/ios/2026-10-25/README.md)。无签名包不能直接安装到 iPhone。

## 使用方式

需要安装包含本次代码的 **OpenGym iPhone App**；Safari/PWA 无法直接调用 HealthKit。
无需另外创建一个独立的同步 App。原来的快捷指令继续可用，也可完全不安装 App、继续手动同步。

App 中连接自己的 HTTPS OpenGym 服务器并登录，打开“睡眠与恢复”，找到“iPhone 自动同步”：
1. 粘贴原有的 Apple 健康上传凭证（可包含 Bearer 前缀）；不会替换或撤销快捷指令凭证。
2. 选择启用，在 iOS 健康授权窗口允许睡眠、静息心率、HRV、训练及心率的读取。
3. 日常健康首次回填最近 30 天，后续上传新增和删除；同时补传回填起点之后符合条件的缺失训练心率。需要更早历史时仍可使用分窗口快捷指令补传。
4. “立即同步”可主动重试；页面显示上次成功时间、待重试批次和错误。
5. “停止自动同步”清除本机凭证、游标和待传队列，不删除服务器记录，也不撤销快捷指令凭证。

系统不允许 App 查看用户是否真正授予某项 HealthKit **读取**权限。空查询可能代表没有数据或未授权，不视为健康数据完整性证明。
后台执行由 iOS 决定；锁屏、低电量、系统限制或手动强退都可能影响时效，不能承诺每小时准时或锁屏实时同步。

## 传输和账户边界

- HealthKit 原始 UUID、绝对起止时间、类别/数值、来源名称和来源 bundle identifier 保留到服务器。
- 每页最多 500 个 HealthKit 变更，固定查询起点为首次启用前 30 天；后续不是滚动时间窗，使用各类型独立 HKQueryAnchor。
- 待传页及 next anchor 先原子落盘；收到服务端 `ok:true` 且 metric 匹配才推进游标并清除待传页。
- 网络失败保留原批次，前台恢复、HealthKit observer 或系统后台刷新机会重试，失败退避。系统后台刷新不保证时点。
- Keychain 使用 AfterFirstUnlockThisDeviceOnly 保存上传凭证。队列和游标使用 iOS 文件保护、排除备份；没有健康 payload 或令牌日志。
- 上传仅允许 HTTPS；拒绝 HTTP 重定向，避免向重定向目标转交凭证。
- 账号退出、退出全部设备、重新配对服务器前先停用原生同步。停用失败会中止退出/切换，不能悄悄留下另一个账户的后台同步。
- 当前原生网络直连服务器；未集成 Cloudflare Access 服务令牌。受额外网关保护的服务器需先解决其原生认证通道，遇到重定向会报告失败。

## 服务端

`POST /api/daily-health/healthkit` 使用原有上传专用凭证；账户会话不能代替上传凭证。
包含 `metric`, `timezone`, `unit`, `samples`, `deleted`。详见 OpenAPI。
支持历史修正，不受快捷指令 32 天窗口约束；样本本身仍执行原有时间、单位、阶段和来源校验。

UUID 幂等 upsert 和删除，重复重试不增加记录；删除 UUID 留存 tombstone，延迟到达的另一台设备不能复活该 UUID。
原生首次收到记录时合并同区间/来源/类别的旧快捷指令记录。快捷指令重传同一记录保留 native UUID。
旧快捷指令没有 UUID，因此无法识别一个未被原生导入过的旧记录是否已从 HealthKit 删除；短期手动兜底并不等于完整删除镜像。
全量删除服务器日常健康数据时，需要先停止手机自动同步；重新启用可回填最近 30 天。已有游标不会自动感知服务器端清库。

## iOS 编译与安装

在有完整 Xcode 和支持 HealthKit 的开发团队签名环境中：

```sh
cd frontend
VITE_MOBILE=1 npm run build
npx cap sync ios
npx cap open ios
```

Xcode 中选择 App target、实际的 bundle identifier 与开发团队，启用 HealthKit（含 Background Delivery）及 Background Modes → Background fetch。
本项目已经设置 HealthKit entitlement、读取用途文案和后台刷新 identifier。
若修改 bundle identifier，应同时修改 `HealthKitSync.refreshIdentifier` 与 Info.plist 的 permitted identifiers。
使用自己的 bundle identifier 和签名配置安装真实 iPhone；发布需走正常签名/TestFlight/App Store 流程。

2026-10-24 的初次实现仅有 Command Line Tools；2026-10-25 已补齐完整 Xcode/iOS SDK 并完成设备版编译。编译成功仍不代表签名或真机健康行为通过。

## 真机验收清单

- 分别允许与拒绝某类读取权限；无数据不报告“已授予读取权限”。
- 最近 30 天回填、第二次零增量、跨午夜阶段，与健康 App 逐段核对。
- 断网后有待传批次，杀进程重启后以同一批次重试；服务端 ACK 后才推进游标。
- 手机与服务器之间 ACK 丢失后重试，无重复；删除记录后同步，再发送旧 UUID 不复活。
- 锁屏/解锁、后台唤醒、低电量、前台恢复、后台任务到期的实际行为。
- 退出与换账号后，旧凭证及队列清除，新账号未启用时不读取或上传。
- 撤销上传凭证后显示 HTTP 401，训练数据和快捷指令不会被启用操作轮换。

## 图表移植

Web 图表移植自 [SleepChartKit](https://github.com/DanielJamesTronca/SleepChartKit) 的 `SleepTimelineGraph` 和 `SleepChartConstants`，固定上游 commit `a2f82bc463cf5a75ccb16652f2bcf572b11de1a3`。
保留阶段顺序、圆角条、贝塞尔连接线（控制点 0.3 / 0.7）、五行结构和虚线刻度。
SwiftUI Canvas 改为 React/SVG；无观测的间隙不画连接线，避免把留白误解成连续观测。
增加日期切换、触摸/键盘区间详情以及短片段附近 22px 的点选范围。
完整 MIT 许可在 `frontend/public/licenses/SleepChartKit.txt`，网页保留作者项目和许可入口。

## 2026-10-24：训练心率与可构建交付补齐

本节记录 2026-10-24 的实现范围；当时尚无完整 Xcode。2026-10-25 的编译与交付状态见文首及构建记录。

### 新增行为

- 健康读取范围增加已保存训练和普通心率。启用前使用 `POST /api/heart-rate/pending` 的 `expected_owner` 核对上传凭证所属账户，核对成功后才申请 HealthKit 读取并持久保存配置。
- 首次回填起点之后，自动补传服务端缺失且当天只有一条 OpenGym 记录的训练心率。读取实际 Apple 训练 UUID/时段，不猜测起止时间；同日多场 Apple 训练沿用服务端窗口并集规则，会同步最早开始/最晚结束到 OpenGym，保留组数与重量。
- 无 Apple 训练或无心率时跳过，下一轮重新查询。已有训练心率不覆盖，不镜像训练删除，也不自动补齐已存训练的迟到心率。这沿用现有 batch 协议边界；若首次上传时手表数据未到齐，需核对后通过现有导出/删除/重传流程补齐。
- 训练上传 body 先持久落盘，网络/进程中断后重试同一批次。只有符合协议的 ACK 或明确的 batch skip 才清除；服务端已存但 ACK 丢失后，already_imported 响应结束重试。
- 修复 Capacitor 7 本地插件不会被 npm packageClassList 自动发现的问题：实际 storyboard 使用专用 bridge controller 显式注册 HealthKit 与已有 Print 插件；增加原生项目集成检查，避免仅打包网页但桥接不可用。
- 心率 observer 使用 hourly 通知频率，其余类型使用 immediate 请求；这些是系统调度请求，不保证时间。
- 新的并发启用保护及退出期间取消标记，防止授权弹窗返回后恢复已停用的上传配置；同步期间新 observer 事件安排后续重查。
- 同步卡片持续刷新前台状态，展示日常健康变更数、训练保存/跳过数和待传批次。禁用后保留重新启用入口；账户切换后丢弃旧响应。
- 状态时间标为“上次检查完成”；零变化明确可能表示无数据或未授权，不代表手表到 iPhone 已完整同步。后台注册失败提供前台同步提示。

### 服务器兼容要求

2026-10-25 06:32:40（Asia/Taipei）已部署包含 `expected_owner` 校验/owner 响应的新 API，原生 App 的服务器兼容要求已满足。旧快捷指令不传 expected_owner，响应形状保持不变；不会轮换既有凭证。原生客户端遇到旧服务器不会忽略账户核对结果继续上传。

上传 `client=opengym-healthkit` 时服务端来源标签为 apple-health-native；该字段是客户端标签，不是硬件来源证明。日常健康仍保留原始 source/sourceIdentifier/UUID。

### 无需 iPhone 的构建入口

从仓库根目录：

```sh
npm --prefix frontend run build:ios -- --check
npm --prefix frontend run build:ios -- --prepare
```

`--check` 检查完整 Xcode/iOS SDK 和 CocoaPods，缺少时退出 2。
`--prepare` 构建 mobile 网页、放入运动素材、执行 cap copy ios，并校验原生包内网页资源。这不安装 Pods、不编译 Swift，也不会生成 IPA。

完整 Xcode 和 CocoaPods 就绪后：

```sh
npm --prefix frontend run build:ios
# 也可以只编译其中一个目标
npm --prefix frontend run build:ios -- --simulator
npm --prefix frontend run build:ios -- --device
```

默认依次执行 cap sync ios、通用模拟器 Release 编译和通用 iPhone Release 无签名编译，不需要手机连接或模拟器 runtime。当前 ML Kit 7.0.0 依赖排除 arm64 模拟器，完整模拟器产物为 x86_64；不能直接在只支持 arm64 的 iOS 27.0 runtime 中运行。依赖下载仍需要网络。输出在 `frontend/ios/App/output/{simulator,device}/Build/Products/`。

新增手动触发的 `.github/workflows/ios-build.yml` 和共享 App scheme，供有 Xcode 的 macOS runner 执行相同流程；尚未推送或运行该工作流。上传的 unsigned .app 仅用于编译验证，不能直接安装到 iPhone。

实际安装需要在 Xcode 选择自己的开发团队、唯一 bundle ID 和支持 HealthKit 的 provisioning profile，配置 HealthKit/Background Delivery 后签名。当前沿用上游 bundle ID，不能作为自己的发布身份。若更改 bundle ID，须同时更新后台刷新 identifier 及 Info.plist。

### 本地检查（2026-10-24）

- mobile 网页构建、素材 staging、cap copy ios、两份 mobile bundle 内容校验通过。
- Swift Foundation 协议检查实际编译执行通过：旧状态迁移、持久重试、错误 ACK 不推进游标、严格响应字段类型、DST 日期边界。
- HealthKit/Capacitor Swift 文件只通过 parser 检查；这不验证 SDK API 类型、Swift/ObjC 桥接或链接。
- 前端相关测试 36/36、服务端相关测试 24/24 通过；包括账户切换、旧响应隔离、凭证归属和真实 HTTP 路由。
- 完整 Xcode/iOS SDK 编译、签名、安装、真实健康读取及后台调度仍待完成。

### 回家后的最小验收

1. 先确认 iPhone 健康 App 已收到 Watch 的当天训练、心率和睡眠记录，再启用 OpenGym；记录授权范围。
2. 检查同步卡片计数，核对一晚睡眠分期、一场训练心率及训练起止时间；在 OPPO 的同一账户查看。
3. 再同步一次应不重复；断网同步产生待传批次，联网重试后清除。
4. 分别验证锁屏、强退后再打开、静息心率修订和删除睡眠样本；观察实际后台延迟。
5. 退出账户/换账号后没有旧账户上传，错账户凭证在读取前被拒绝。

Apple Watch 独立上传的能力、限制及实施顺序见 [调研报告](APPLE_WATCH_UPLOAD_RESEARCH.md)。


## 2026-10-25：完整 SDK 编译与交付

- macOS 27.0.1 / Apple silicon；Xcode 27.1（27A9275）、iOS SDK 27.1、CocoaPods 1.17.0。
- 原生依赖安装完成，新增 Podfile.lock 和 workspace 引用，保留依赖版本以便复现。
- `npm --prefix frontend run build:ios -- --device` 完整成功；正式 iPhone 包包含扫码库以及 HealthKit/Print 本地插件。
- 通用完整模拟器 Release 构建成功，架构 x86_64。已安装 runtime 只支持 arm64，因此另外在临时副本中去除 CapacitorMlkitBarcodeScanning 的 iOS pod 和注册项，构建 arm64 验证包；正式代码与设备产物未被修改。
- arm64 验证包安装/启动成功，实际画面显示“Use on this device / Connect to my server”初始页面；未连接个人账户，未申请健康权限、读取或上传真实健康数据。此验证不覆盖扫码、HealthKit 后台或真实 iPhone。
- SDK 类型检查、Swift 协议检查、原生工程集成检查通过。上游框架存在弃用警告；不将编译成功表述为端到端健康同步已通过。
- 已打包 `openGym-1.4.1-healthkit-20261025-unsigned.ipa`，ZIP 完整性与 SHA-256 校验通过。大小约 201.2 MiB；manifest 记录 SDK、版本、架构与验证边界。
- 当前代码签名身份数为 0。下一步需在 Xcode 使用所有者自己的 Apple 账户/开发团队、唯一 bundle ID 和支持 HealthKit 的 provisioning profile 完成签名；无需向聊天发送密码或私钥。仍沿用上游 bundle ID 的无签名包仅用于构建交付。

完整产物和安装边界见 [交付说明](../artifacts/ios/2026-10-25/README.md)。

服务器部署采用原镜像两文件覆盖（heart-rate.js、heart-rate-metrics.js），21 项隔离测试通过；备份上传成功、个人数据部署前后校验一致、公开 health 200，匿名及无效上传凭证均 401。回退与镜像信息见 OPERATIONS.md。
# 当前 iPhone App：使用登录账号同步

2026-10-25 更新：原生 HealthKit 同步直接复用 App 已登录的服务器会话，用户无需创建、复制或粘贴第二份健康上传凭证。首页只显示一张「Apple 健康同步」卡片；首次启用时由 iOS 请求健康读取授权。同步说明、样本检查统计和停用操作放在 Information 按钮中。

App 登录会话续期时，原生安全存储中的同一会话随之更新，保留同步游标和待上传批次。退出登录、断开服务器时停止同步；服务端按登录会话验证用户、有效期、禁用状态和会话撤销，数据写入当前账号。已有快捷指令上传凭证仍兼容旧客户端，原生 App 不再创建或要求它们。

统计页在「活动」下方展示最近 7 天睡眠图和当天已记录的营养摄入。睡眠与饮食详情的左箭头按进入来源返回首页或统计页。

以下保留早期实现与验收记录；其中手工粘贴上传凭证的流程已由上述登录会话流程取代。真实健康读取、上传与后台调度仍需在用户授权后的真机上核验。
