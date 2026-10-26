# OpenGym Apple Watch 同步端开发文档

日期：2026-10-25（Asia/Taipei）。本文件先于实现编写，交付结果记录在文末。

最新状态：2026-10-26 已部署 0.2.0 网页扫码绑定，实体手表安装清单确认新版；远程启动受系统状态限制，手动打开与扫码验收待用户确认，见 [扫码绑定设计与实施](WATCHOS_QR_PAIRING_DESIGN.md)。0.1.0 已在 Apple Watch Series 7 / watchOS 26.6 上完成开发签名、安装及进程启动验证，用户已确认看到连接首页。健康授权、读取及上传仍需验收；详见文末真机安装记录。

## 目标与首版范围

Apple Watch 本机 HealthKit → 本机持久队列 → OpenGym HTTPS API → OPPO 网页或 Android App。
采用独立、单 target 的 SwiftUI watch-only 应用，不依赖 OpenGym iPhone App 在场。
最低 watchOS 26.0，兼容用户的 watchOS 26.6；使用 Xcode 27.1 / watchOS 27 SDK 编译。
保留现有 iPhone 项目，新增 `frontend/watchos/` 工程，无第三方运行时依赖。

首版完成：

1. 在手表输入 HTTPS 服务器根地址、账户 ID、现有 Apple 健康上传专用凭证。
2. 先验证凭证归属，再允许请求健康读取权限；配置存入 Keychain。
3. 检查最近 7 天的睡眠、静息心率、HRV、已保存训练、心率，显示样本条数、最新时间和平台允许的最早读取日期。
4. 手动上传睡眠分期、静息心率、HRV SDNN。首次查询最近 30 天与平台历史下限的交集，后续逐类型 anchored query。
5. 每页最多 500 条 HealthKit 变更；先持久保存批次，再发送；仅正确 ACK 后推进游标。断网或退出应用后，下次手动重试相同批次。
6. 显示上次检查完成时间、待传批次数及可操作的错误。解除连接清除手表配置和队列，不撤销账户共用凭证、不删除服务器记录。

## 明确的阶段边界

- 不在首版启动/写入训练，不用虚假训练会话换取后台时间。
- 训练、普通心率首版仅用于读取诊断；训练关联上传沿用已有 iPhone 端，后续再移植。
- 首版只在用户主动检查/同步时工作，不注册后台 observer 或后台 URLSession，不承诺熄屏后继续上传；应用挂起后可重新打开手动重试。
- 手表的历史清理与用户删除的差异尚未真机验证。首版接收 anchored query 的删除事件但**不转发删除**，记录忽略数量；服务器中旧 UUID 不会因此被清除。这是新增/更新同步，不是完整镜像。历史修订若更换 UUID，旧 UUID 也可能保留，须真机核对。
- 0.1.0 复用账户已有上传专用凭证；0.2.0 已扩展为每设备独立的扫码绑定协议，旧手动配置继续兼容。
- 健康读取授权无法被可靠查询。空结果显示“无可读样本，也可能未授权”，不显示“完整同步”或“已授予所有权限”。

## 用户流程

首次打开 → 连接说明 → 配置页（服务器、账户 ID、上传凭证）→ 验证并保存 → 状态首页。
配置页提示账户 ID 不是显示昵称；获取时在已登录的 OpenGym 同源访问 `/api/me`，取响应的 `user.id`。凭证来自已有 Apple 健康同步设置。
当前凭证若已不可获取，重新生成会影响其他使用同一凭证的客户端，文档提示先核对，不自动生成。

首页：

- “检查本机数据”：对已验证保存的连接请求 HealthKit 读取权限，查询最近 7 天，展示五类数据概况；每类型最多显示 500 条，用 `500+` 明示截断。本机检查可离线进行。
- “立即同步”：验证当前凭证仍属于配置账户，请求读取权限，恢复待传批次，再分页读取三类日常健康数据并上传。若启动时网络不可用，对已验证连接最多暂存一页睡眠数据（含零样本页），保留原游标；其他类型待联网后继续。收到明确 401/403 则阻止读取及上传。离线已有待传页时不覆盖它；联网后必须重新校验账户，再重试完全相同的请求字节。
- 状态文案使用“上次检查完成”，零条数据不代表健康数据完整。
- “连接设置”：显示服务器和账户 ID；解除连接有二次确认，进行中的检查/上传会被取消，旧异步结果不得重新保存状态。

不在日志、截图测试配置、项目或构建产物中写入真实凭证和健康数据。

## 结构

| 文件 | 职责 |
|---|---|
| `OpenGymWatch.xcodeproj` | 可直接打开的独立 watch-only 工程与共享 scheme |
| `App/OpenGymWatchApp.swift`、`ContentView.swift` | SwiftUI 生命周期、连接表单、状态与诊断 |
| `Core/WatchSyncEngine.swift` | 可注入健康读取、传输和存储的串行同步状态机 |
| `Core/WatchModels.swift` | 配置校验、队列、概况、错误文案 |
| `App/WatchHealthReader.swift` | HealthKit 授权、分页、序列化、诊断 |
| `App/WatchStorage.swift` | Keychain 与受保护原子文件 |
| `App/WatchTransport.swift` | HTTPS、限时请求、拒绝重定向 |
| `../ios/App/App/HealthSyncModels.swift` | 只读复用现有严格 ACK 协议 |
| `Tests/WatchSyncTests.swift` | 真实同步状态机的离线失败/重启/账户隔离测试 |
| `scripts/check-watchos.sh` | 协议测试及模拟器、设备 SDK 编译入口 |

## 协议与存储不变量

连接校验：新 `ogw_` 凭证使用 `POST /api/watch-devices/verify`，旧凭证使用 `POST /api/heart-rate/pending`。Bearer 上传凭证，body 为 `{"expected_owner":"账户 ID"}`。
必须返回 HTTP 200 且 `owner` 完全匹配，才持久配置或读取健康样本。
每次同步重新校验，401/403 保留本地批次并提示更新连接；不得轮换凭证。首次连接必须在线验证通过；之后网络不可达可本地排队，但不能未经本次在线校验就上传。

上传：`POST /api/daily-health/healthkit`，沿用现有 `metric/timezone/unit/samples/deleted` 协议。
`metric` 为 `sleep/restingHeartRate/hrv`；HRV 为 SDNN/ms，静息心率 bpm，睡眠保留系统分期。
保留 UUID、带时区的绝对起止时间、来源名称及 bundle identifier；不计算恢复评分。
首版 `deleted` 总是空数组；忽略的删除数量单独展示。
ACK 必须是严格布尔 `ok: true` 且 `metric` 匹配，复用 iPhone 端协议解析器。

Keychain：保存配置（含随机 connection ID），使用 `AfterFirstUnlockThisDeviceOnly`。
队列：Application Support 内 JSON，原子写入、首次解锁后文件保护、排除备份。
状态文件绑定 connection ID；配置与文件不匹配时从空状态开始，禁止把旧账户批次交给新账户。
持久化写入失败时不发送新批次；ACK 后写入失败，保留原批次，下次幂等重试。
解除连接先增加 generation、取消当前请求，再移除凭证；异步回调必须核对 generation。
拒绝含用户名、密码、查询、fragment、子路径的服务器 URL；仅接受 HTTPS origin。
禁用 cookie、URL cache 和重定向；失败消息不回显服务器响应或凭证。

## 实施顺序

1. 完成本文件与验收边界。
2. 实现配置校验、持久状态机、注入式传输/健康读取及失败测试。
3. 接入 HealthKit、Keychain、HTTPS，创建 watchOS 工程及 SwiftUI 界面。
4. 运行核心测试、watchOS 模拟器和设备 SDK 的完整构建。
5. 模拟器安装启动，核对初始界面与小屏适配；不使用个人账户，不将模拟数据当真机证据。

## 验收

自动：拒绝不安全地址/无效凭证；错误账户在读取前被拒绝；错误 ACK 不推进 anchor；网络失败持久保留批次；启动即离线仍可暂存一页；离线诊断；重启重试完全相同字节；ACK 后磁盘失败仍可重试；解除/切换连接隔离旧异步结果；删除不转发；分页和三类指标完成；空结果不会声称完整。

本机：Swift 测试通过；Release 模拟器/arm64 设备构建通过；最低版本 26.0；模拟器安装启动、初始页面可操作。真实签名与授权需用户自己的开发团队，未配置时交付无签名构建。

真机（待有设备/签名后）：

- watchOS 26.6 安装；权限允许、部分拒绝、无记录与锁屏行为。
- 对照 iPhone 健康 App 核查五类可读数量、时间、睡眠阶段、SDNN 和本机历史范围。
- iPhone 不在场，经 OPPO 2.4 GHz 热点直连服务器；断网排队、重开恢复、ACK 丢失后无重复。
- 手机上已有相同 UUID、不同 UUID 的双端交错上传、静息心率修订与手表历史清理。
- 撤销凭证后 401；解除连接后无后续上传；重装/换账户无旧批次泄漏。

## 官方依据

- [独立 watchOS 应用](https://developer.apple.com/documentation/watchos-apps/creating-independent-watchos-apps)
- [watch-only 标记](https://developer.apple.com/documentation/bundleresources/information-property-list/wkwatchonly)
- [平台允许的最早样本日期](https://developer.apple.com/documentation/healthkit/hkhealthstore/earliestpermittedsampledate())
- [HealthKit 授权](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- 原项目边界：[可行性调研](APPLE_WATCH_UPLOAD_RESEARCH.md)、[iPhone 同步](HEALTHKIT_NATIVE_SYNC.md)。

## 实施记录

2026-10-25：首版已按本文件实现，源代码和可打开的工程位于 `frontend/watchos/`。

- `bash frontend/watchos/scripts/check-watchos.sh --all` 通过：实际状态机测试、共用 ACK 协议测试、Release 模拟器构建、Release 设备 SDK 无签名构建、watch-only 标记与最低版本 26.0 校验。
- 状态机测试使用真实 JSON 文件及新建 engine 模拟重启，覆盖网络中断（含启动即离线）、持久写失败、ACK 后写失败、分页、明确撤销、账户隔离、解除连接与迟到回调；临时目录自动清理，无真实凭证。
- `node --test api/test/healthkit.test.js api/test/health-upload-credentials.test.js`：4 项兼容性测试通过，未修改或部署服务端。
- watchOS 27.0 的 Series 12（46 mm）与 SE 3（40 mm）模拟器安装/启动成功；已检查初始页面截图并收紧小屏布局。
- 首次截图暴露了完全关闭模拟器签名导致的 Keychain -34018（缺 application identifier）。已将模拟器构建改为 Xcode 本地 ad hoc 签名，不需要个人证书；重新安装后的初始安全存储读取恢复正常。设备交付包仍保持无签名。
- 仅剩 Xcode 的 AppIntents 元数据提取提示（应用没有 AppIntents 依赖）；没有 Swift 编译错误或 Swift 警告。
- Computer Use 被 Mac 锁屏阻止，因此未完成连接表单、导航及按钮的交互验收；安装、启动与截图使用 `simctl`。未绑定个人账户、未读取或上传真实健康数据。
- 本机已有代码签名身份，但此独立工程尚未选择开发团队、替换占位 bundle ID 或完成 HealthKit provisioning。交付设备包保持无签名；尚未安装到用户的 watchOS 26.6 真机。
- [设备构建包、截图与来源校验](../artifacts/watchos/2026-10-25/README.md)。所有真机项目与后续阶段仍按上面的验收清单进行。

### 2026-10-25：首次实体手表安装

- 目标为 Apple Watch Series 7（Watch6,7），watchOS 26.6。配对手机为 iPhone 13 / iOS 27.0.1；Mac 使用 Xcode 27.1。
- 初始 Watch 开发者模式入口未出现。重新插接配对手机后，手表出现信任提示；随后经设备重连，Xcode 识别到实体 Watch 并提示开启开发者模式。用户已开启，设备诊断确认 `developerModeStatus=enabled`、已配对、开发隧道已连接。
- 仅 Watch 工程设置了本机已有 Personal Team 自动签名，Bundle ID 改为 `com.example.opengym.watchsync.watchkitapp`。Xcode 显示 Xcode Managed Profile / Apple Development；未移除 HealthKit capability。
- Xcode DerivedData 的 Debug-watchos 应用通过 `codesign --verify`，版本为 0.1.0（1），最低 watchOS 26.0，签名包含 HealthKit entitlement。
- Xcode Run 等待获取设备调试符号，因此使用已签名产物通过 `devicectl device install app` 安装、`devicectl device process launch` 前台启动。设备安装清单和运行进程均确认成功，不将符号下载视为安装证据。
- Device Hub 画面镜像仍停在 `Connecting display…`；未能从 Mac 独立确认实际应用画面。用户随后亲自在手表上确认已看到 OpenGym 连接首页，初始界面验收通过。
- 未请求 HealthKit 授权，未读取或上传真实健康数据。服务器绑定、授权拒绝/允许、数据核对、离线重试与 OPPO 热点验证继续待验收。
- 早先无签名 ZIP 和 `source-digests.json` 保留为首版编译时的历史快照；本次本机签名设置另见 [真机安装记录](../artifacts/watchos/2026-10-25/device-installation.json)，未把包含个人 provisioning profile 的签名包发布或上传。

### 2026-10-25：0.2.0 网页扫码绑定

手表 QR → 手机网页登录并核对短码 → 明确批准 → 手表领取独立 `ogw_` 凭证 → Keychain 持久保存 → ACK 后显示已连接。此过程不读取健康数据。网页可单独撤销一块表；现有 iPhone 和快捷指令凭证不受影响。支持有效期、拒绝、取消、前台重试及重启恢复；服务端重启使未完成会话失效，已完成连接保留。

新增 `Core/WatchPairing.swift`、`App/WatchPairingStorage.swift`、`App/PairingConnectionView.swift`，以及后端 `api/watch-{pairing,credentials}.js`、网页 `WatchPairing.jsx`。具体本地验证、全量测试限制和部署顺序见 [0.2.0 交付记录](../artifacts/watchos/2026-10-25/qr-pairing-0.2.0/README.md)。真机仍为 0.1.0；0.2.0 未安装到实体 Watch，未部署新服务器端点。

### 2026-10-26：0.2.0 正式上线与实体手表更新

用户明确批准后，已部署 API/Web 并完成加密一致性备份。最终 Linux 镜像 12 项测试通过；个人数据校验值一致，公网资源和接口验证通过。Series 7 / watchOS 26.6 安装清单确认 0.2.0（2）；首次 CoreDevice 连接中断后，唯一一次安装重试成功。远程打开被手表当前系统状态拒绝，需用户解锁后手动打开并扫码确认；没有绕过设备限制。真实健康权限、读取及上传仍未进行。详见 [部署与设备验收记录](../artifacts/watchos/2026-10-26/qr-pairing-release/README.md)。

### 2026-10-26：0.3.0 原生导航与界面整理（本地完成，尚未部署）

- 按 Apple HIG 的 [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)、[Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators) 实现。连接页改为 `NavigationStack.navigationDestination`，由系统提供后退按钮，移除自定义关闭工具栏。首次连接使用系统提醒说明手机扫码与网页确认步骤。
- 二维码页按可用高度缩放，无 ScrollView、字母码或额外说明。过期压暗二维码并显示红色状态标记、绿色系统重新生成按钮；扫码后中央显示局部进度，ACK 成功后显示绿色勾，再返回首页。红色标记是非交互状态，不伪装为按钮。
- 未连接首页仅保留连接按钮。已连接首页以居中立即同步为首要操作；上传计数移入同步详情。概况页自动检查，每个指标合为一个紧凑行，最新检查时间使用相对时间小字；移除历史起点等内部术语。解除连接说明改为操作下方的 Section footer。
- 服务端保留 `status: pending`，新增可选 `scanned` 布尔值，兼容旧手表协议。手机确认页改为确认刚扫描了身边的手表，不再要求核对不可见字母码。
- 40mm SE 模拟器审查了首页、二维码、过期、扫码等待、成功、已连接首页、数据概况。除未连接首页外，截图由独立临时构建注入合成状态，只检验 SwiftUI 实际布局，不代表真实扫码/健康上传验收。构建与截图见 `artifacts/watchos/2026-10-26/ui-refinement/`。


### 2026-10-26：0.3.0 正式部署

上述本地变更已于 02:09:47（Asia/Taipei）上线；手表安装清单确认 0.3.0（3），远程启动成功。加密备份完成，20 个个人数据文件校验值保持一致。新版快捷指令下载已验证，需要在手机替换旧的同名快捷指令。详见 [部署记录](../artifacts/watchos/2026-10-26/ui-release/README.md)。


### 2026-10-26：0.4.0 界面细化正式部署

欢迎页加入紧凑健康图标与用途说明；二维码白底圆角，扫码后取消进度遮挡；页内方向提示及右上角连接说明可随时查看。过期显示为普通状态文字，只保留重新生成按钮。网页绑定使用可选备注名和一个明确绑定动作；空白备注保存为 Apple Watch。网页首页同步动作与查看数据入口分开，统一睡眠与恢复叫法。

02:51:40（Asia/Taipei）API/Web 上线，发布前加密备份已上传；19 个个人数据文件切换前后校验值一致。Linux 隔离镜像 13 项检查通过。Series 7 安装清单独立确认 0.4.0（4），远程启动成功；首次安装连接失败后一次重试成功。实体屏幕、手机扫码及真实 HealthKit 同步仍需用户验收。同步性能和快捷指令文件未改。详见 [0.4.0 部署记录](../artifacts/watchos/2026-10-26/ui-polish-release/README.md)。


### 2026-10-26：0.4.2 空闲轮询耗电修复部署

主页面仅在 scenePhase 为 active 且有操作进行时每秒读取同步进度；空闲时和进入 inactive/background 后停止轮询，回到 active 时刷新一次状态。此修改不增加自动上传或后台运行。现有 Watch 同步、配对与共用协议测试通过，模拟器及设备 Release 编译通过；Signed Release 0.4.2（6）通过签名校验并使用 devicectl 安装至 Series 7。耗电改善仍需真实夜间对照记录验证。

### 2026-10-26：0.4.1 Information 按钮修复部署

扫码连接页的说明按钮明确使用单色白色 `info.circle`、plain 样式和白色 tint，避免继承应用绿色强调色后呈现为整块绿色圆。模拟器预览带上应用强调色后，已确认信息图标清楚可见。Signed Release 0.4.1（5）已安装至 Series 7，独立安装清单和远程启动均通过；实体屏幕效果待用户确认。03:30:01（Asia/Taipei）同时部署网页饮食改版与绑定页文案清理，iPhone 工程未改。详见 [部署记录](../artifacts/ui/2026-10-26/nutrition-release/README.md)。
