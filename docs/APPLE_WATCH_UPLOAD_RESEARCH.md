# Apple Watch 独立上传 OpenGym：可行性调研

核查日期：2026-10-24。适用场景：iPhone 常驻家中，日常使用 OPPO Find X8 Ultra / ColorOS 17，Apple Watch 负责记录。
状态（2026-10-25 更新）：已实现独立 SwiftUI 手动同步首版，模拟器与设备 SDK 编译通过、模拟器安装启动通过；真机读取与上传尚未验证。已知用户系统为 watchOS 26.6，手表型号与蜂窝套餐仍未知。首版范围、暂不转发删除事件的边界及验证记录见 [开发文档](WATCHOS_DEVELOPMENT.md)。下文保留初次调研的完整路线设计，后续阶段不代表已实现。

## 结论

技术路线可行，推荐独立 watchOS 同步端直接访问 OpenGym HTTPS API。OPPO 负责查看数据，必要时提供 Wi-Fi 热点；不经过 OPPO 健康的数据转存。

“独立”指日常读取与上传无需 OpenGym iPhone App 在场，不代表取消 Apple Watch 原有的 iPhone 配对与管理关系。先保留家中 iPhone 作为历史补齐和维护入口。

第一版应以“手表点一次同步，有网立即上传，无网保存后重试”为验收目标；后台自动上传作为机会性优化。不能承诺即时持续同步。

## 官方证据与边界

| 问题 | 官方能力 | 对本项目的含义 | 尚需验证 |
|---|---|---|---|
| 能否脱离 iPhone App 运行 | 支持 watch-only / independent watchOS App，可在手表直接安装、登录、联网 [1] | 无需移植完整 OpenGym 训练界面，建立小型上传端即可 | 开发签名、实际设备安装 |
| 能否在手表授权健康读取 | watchOS 6 起可在手表显示 HealthKit 权限页 [2] | 日常授权不必靠家中 iPhone 完成 | 各类型授权拒绝、再次授权、锁屏后的表现 |
| 能否读取本机健康数据 | watchOS 有自己的 HealthKit store，旧记录可能被系统清理 [3] | 读取本机样本后直接上传；使用 earliestPermittedSampleDate() 界定可用历史 | 本型号上的实际历史范围、各类型样本到达时机 |
| 能否直连服务器 | URLSession 支持经配对 iPhone 代理、Wi-Fi 或手表蜂窝连接 [4] | 外出时可尝试 OPPO 热点；蜂窝版可评估自己的数据连接 | OPPO 热点兼容性、耗电、休眠断连、运营商限制 |
| 能否后台感知健康变化 | watchOS 8 起支持 HealthKit background observer；需相应 entitlement [5][6] | observer 触发 anchored query；不能只写 observer 就声称可靠自动上传 | 实际调度频率、唤醒预算、锁屏读取、低电量 |
| 能否后台完成网络请求 | watchOS 支持持久 background URLSession，系统可能推迟执行与回调 [7] | 需要持久请求文件、任务映射与 completion delegate，不能直接照搬 iPhone 的 ephemeral session | 进程终止、重启、超时、网络切换、响应丢失 |

Apple 当前 ClockKit 文档描述：在活动表盘有 complication 时，HealthKit observer 与 app refresh 共享每小时最多四次的预算。这是该文档场景下的上限，不是所有手表、所有配置下的频率保证，也不能直接当作未来 WidgetKit 配置的 SLA。[5]

## 哪些数据适合首版

| 数据 | 方案 | 验收要求 |
|---|---|---|
| 睡眠分期 | 读取 sleepAnalysis 的 category samples | 比较 Core/Deep/REM/Awake、跨午夜时间和来源；没有分期不伪造 |
| 静息心率 | 读取 restingHeartRate | 使用系统产生的样本，不把普通静止时心率当静息心率。Apple Watch 可能替换当天或前一天的估计，必须处理删除与新增 [8] |
| HRV | 读取 heartRateVariabilitySDNN，以 ms 上传 | 保留 SDNN 语义；不是连续监测，也不据此生成未经验证的恢复分数 |
| 训练与训练心率 | 查询已保存 HKWorkout，再查询对应时间窗口的 heartRate 样本 | 手表端读取现有训练记录；不额外启动一场训练来维持后台运行 |

上表是 API 设计目标，不是这些数据在用户这块表上都已验证可读。iPhone、手表有各自的数据仓库，不能假定手表拥有手机上所有第三方来源或已计算的历史指标。第一阶段必须用真实设备核对五种读取结果。

HealthKit 不提供“用户已允许读取某类型”的可靠状态；空结果可能是无记录、未授权或可读历史受限。“请求权限完成”与“数据完整”需分开显示。[2]

## 推荐数据链路

Apple Watch 本机 HealthKit → 本机持久队列 → HTTPS OpenGym → OPPO 浏览器或 Android App。

- 先验证 OPPO 热点：建议从兼容性较好的 2.4 GHz 配置开始测试，手表手动选择热点。Apple 支持兼容 Wi-Fi，但不支持需要网页认证的 captive portal；官方文档没有为这台 OPPO 与该手表组合提供兼容性保证。[9]
- 有蜂窝硬件和已激活套餐时，再独立验证蜂窝联网；不把 OPPO 健康的蓝牙连接当成可供其他 watchOS App 使用的互联网代理。
- 配网完成后，iPhone 留在家里，关闭手表到 iPhone 的连接路径做验收；确保请求确实经热点或蜂窝发出。

## 复用现有 OpenGym 的部分

1. 日常健康 `POST /api/daily-health/healthkit` 已有 UUID upsert、删除墓碑及 ACK 协议，可作为首版基础。
2. 上传专用凭证可查询最小待补训练清单：`POST /api/heart-rate/pending`；本次新增 expected_owner 核对。无需给手表完整账户会话。
3. `POST /api/heart-rate/import` 支持 Apple 训练标识、精确起止时段、对应心率、幂等重试和缺失补传；当天多条 OpenGym 训练仍跳过。
4. Swift 的 ACK 校验、日期处理、队列模型可以共享。HealthKit 授权和 anchored query 的设计可复用。

不能直接搬用的部分：iOS BGTaskScheduler、Capacitor 插件/UI、ephemeral 网络任务的生命周期。watchOS 需要自己的 SwiftUI 小界面、后台入口与后台 URLSession delegate。

现有训练心率接口只做缺失补传，并非完整的逐 UUID 心率镜像。训练刚结束时若心率尚未全部落库，已有记录不会自动补齐后续迟到样本；修改/删除 Apple 训练也不自动修改已导入记录。长期版本需要独立的训练 UUID/样本 UUID 协议、落库等待与重扫规则，先验证后扩展。

## 双端同时上传的设计

iPhone 与手表应各有自己的查询游标与队列，不能复制 HKQueryAnchor 到另一设备。服务器以样本身份进行幂等处理。

现有 daily-health 接口已支持 UUID 去重和删除墓碑，但还需真机核查：同一原始样本经 iPhone 和 Watch 查询后 UUID、来源标识、绝对时间是否一致。不能只凭“应该同步一致”宣布双端不会重复。

若存在不同 UUID、相同时间与来源的记录，应设计来源明确的合并规则；不能仅按时间合并所有设备的数据。训练心率当前按时间和值去重，并由 batch 模式跳过已有记录。

不同端可能有同步延迟。删除与历史修订需要双端交错到达、ACK 丢失后重试等测试；手表历史清理不等于用户主动删除，必须确认 anchored query 是否会产生相关删除事件，避免错误清除服务器历史。

## 绑定与凭证

首个技术原型可手动配置服务器地址和上传专用凭证，但日用版不适合在小屏幕上输入长 token。

推荐日用交互（需要新增绑定协议，当前未实现）：

- 手表显示短时有效的一次性码或二维码。
- OPPO 已登录的 OpenGym 页面扫描/输入，显示待绑定设备，用户确认。
- 手表领取只允许上传和最小 pending 查询的设备凭证，保存在手表 Keychain。
- 每设备单独撤销；撤销 Watch 不应让家中 iPhone 同步失效。

当前账户只有共用健康上传凭证；可供原型复用，但并不具备上述每设备独立撤销能力。正式双端方案应增加设备凭证管理，保留现有快捷指令兼容性。

所有请求仅发往选定 HTTPS origin，禁止跨站重定向携带凭证；队列受文件保护并排除备份，状态只显示计数和错误，不记录健康明细或 token。

## 分阶段验证与通过标准

1. **读取原型**：显示五类数据的数量、最新时间和可读历史起点；与 iPhone 健康 App 对照。不得因空结果显示“完整同步”。
2. **前台上传**：用测试账户验证手动同步、OPPO 热点、断网重试、服务端已存但 ACK 丢失后的重试。
3. **双端一致性**：先 Watch 后 iPhone、反向顺序、重复样本、静息心率修订、用户删除、手表历史清理；无错误丢失或重复。
4. **后台与耗电**：全天实际佩戴，比较有无表盘组件、低电量、锁屏、热点自动关闭、蜂窝/Wi-Fi 切换。报告实际延迟分布，不能只验证一次成功。
5. **日用绑定**：OPPO 完成配对授权、独立撤销 Watch 凭证、重装恢复、账户切换。

顺序建议：先把 iPhone 同步端完成完整 SDK 编译与真机验收，建立数据对照基准；随后做 Watch 前台读取/上传原型，再决定后台投入。现阶段没有理由依赖 OPPO 健康中转。

## 官方来源

1. [Creating independent watchOS apps](https://developer.apple.com/documentation/watchos-apps/creating-independent-watchos-apps)
2. [requestAuthorization(toShare:read:)](https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:))；[Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
3. [About the HealthKit framework](https://developer.apple.com/documentation/healthkit/about-the-healthkit-framework)
4. [Keeping your watchOS content up to date](https://developer.apple.com/documentation/watchos-apps/keeping-your-watchos-app-s-content-up-to-date)
5. [Keeping your complications up to date](https://developer.apple.com/documentation/clockkit/keeping-your-complications-up-to-date)
6. [enableBackgroundDelivery](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:))；[Background delivery entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.healthkit.background-delivery)
7. [Making background requests](https://developer.apple.com/documentation/watchos-apps/making-background-requests)
8. [restingHeartRate](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/restingheartrate)
9. [Connect Apple Watch to Wi-Fi](https://support.apple.com/guide/watch/connect-to-wi-fi-apdff5efc8fb/watchos)
