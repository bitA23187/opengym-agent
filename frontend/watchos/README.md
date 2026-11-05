# OpenGym Watch

SwiftUI watch-only 健康同步端，最低 watchOS 26.0（适用于 watchOS 26.6）。
开发范围、数据协议和真机验收见 [开发文档](../../docs/WATCHOS_DEVELOPMENT.md)。

2026-11-02：0.5.0（7）新增手表直传训练心率、持久化失败批次、训练结果计数和空数据页免上传。保持纯手动同步，不注册健康后台通知或定时刷新。旧版本日常健康同步已由用户确认成功；新版真实训练心率仍需核对。

## 打开与构建

直接在 Xcode 打开 `OpenGymWatch.xcodeproj`，选择 `OpenGymWatch` scheme 和 Apple Watch 模拟器。
只需完整 Xcode；无需 npm、CocoaPods、Swift Package 或新的第三方框架。
工程引用已有 `../ios/App/App/HealthSyncModels.swift` 中的严格 ACK 解析规则。
App 图标直接复用现有 iPhone App 的资源。

从仓库根目录运行：

```sh
# 状态机与持久重试测试（使用临时目录，不读个人数据）
bash frontend/watchos/scripts/check-watchos.sh --test
# 模拟器和真实设备 SDK 编译，设备版不签名
bash frontend/watchos/scripts/check-watchos.sh --all
```

输出位于 `.build/`，日志为 `.build/{simulator,device}-build.log`。
模拟器版使用 Xcode 本地 ad hoc 签名（不需要个人证书），保留模拟器的 application identifier 和 HealthKit entitlement；完全关闭签名会导致 Keychain 返回 -34018。
设备产物 `.build/device/Build/Products/Release-watchos/OpenGymWatch.app` 尚未签名，不能直接安装到手表。

## 真实手表安装

1. 在 Xcode 的 Apple Accounts 添加自己的账户，选择支持 HealthKit 的开发团队。
2. 为 target 选择自己的唯一 bundle ID，确认 HealthKit capability。示例 Bundle ID 为 `com.example.opengym.watchsync.watchkitapp`；请配置自己的唯一 ID 和开发团队。
3. 在 Xcode Device Hub（或 Devices and Simulators）连接已配对的手表及 iPhone，按提示开启开发者模式。
4. 选择 watchOS 26.6 真机后 Run。SDK 27 不要求实体手表升级到 27；最低版本为 26.0。

## 首次使用

点击“连接 OpenGym”，手表自动向预设的 `https://gym.example.com` 申请二维码。手机相机扫码，在网页登录、核对手表短码并确认；手表保持 OpenGym 在前台，自动保存账户与独立设备凭证。无需输入账户 ID 或复制上传凭证。绑定本身不请求 HealthKit 读取权限。

二维码 5 分钟过期；断线后可“继续等待”，过期则“重新生成”。关闭页面/进入后台暂停轮询，重新打开可恢复。网页“睡眠与恢复 → 管理已连接的手表”可输入短码或单独撤销设备。手表“更换服务器”及“高级手动配置”仍可使用；手动配置兼容 `ogh_`、`ogd_`、`ogw_`，不会自动轮换旧凭证。

**上线顺序**：先部署网页和 API，再安装 0.2.0 手表版。正式 API/Web 已于 2026-10-26 更新，实体手表也已更新为 0.2.0（2）。详见 [扫码绑定协议与验收](../../docs/WATCHOS_QR_PAIRING_DESIGN.md)。

保存后：

- **检查本机数据**：请求 HealthKit 读取授权，查看最近 7 天的五类数据；每类上限 500，截断时显示 `500+`。配置保存后可离线检查。
- **立即同步**：上传睡眠、静息心率、HRV，补传服务器上缺失的训练心率。启动即离线时，最多暂存一页睡眠数据（也可能是零样本页）；已有待传批次不会被覆盖。联网后重新校验凭证，重试原来的日常健康和训练批次，再继续读取。在线空数据页仅保存游标，不发送上传请求。
- **同步详情**：展示日常健康条数、训练心率保存/跳过次数与待传状态。训练使用真实 Apple 训练 UUID 和起止时间，沿用 iPhone 的同日匹配规则，服务器已有心率时跳过，不覆盖。
- **连接设置 → 解除连接**：取消操作，清除本机凭证、游标、诊断和待传批次；服务器历史和共用凭证不变。

手表需有可用互联网。OPPO 热点、蜂窝联网、真实健康数据、watchOS 26.6 权限行为仍需真机验收。
按用户偏好，没有后台自动同步、定时唤醒或主动开始训练；仅点“立即同步”后上传。删除事件不转发服务器，避免误删被手表清理的历史。
空结果不能证明已授权或数据完整。模拟器启动与编译成功也不证明真机上传通过。

训练记录必须先保存到 OpenGym 服务器。只补传初始最近 30 天范围内、手表 HealthKit 允许读取的缺失训练；同日多条 OpenGym 训练不自动猜测关联。没有 Apple 训练或心率时跳过，下次手动同步再检查。一天有多场 Apple 训练时，仅关联与 OpenGym 起止时间唯一重叠的一场，无法唯一匹配时跳过。更早历史由 iPhone 补传。单日 Apple 训练超过 5000 或相关心率样本超过 20000 时明确报错，不静默截断。

## 网络失败排查

前台请求会等待 watchOS 建立可用连接，单次请求总时限为 45 秒。可用连接包括配对 iPhone、Wi-Fi 或蜂窝网络，并非必须连接热点。
错误提示区分离线、超时、域名解析、服务器连接、HTTPS 证书和中断；旧版将所有 URL 错误提示为连接 Wi-Fi／热点，无法据此判断历史失败原因。
同步时保持 App 在前台。失败批次会保留到下次手动同步，不会在后台持续重试。训练心率直接从手表 HealthKit 读取，无需先传到 iPhone。
