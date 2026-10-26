# OpenGym Watch

SwiftUI watch-only 健康同步端，最低 watchOS 26.0（适用于 watchOS 26.6）。
开发范围、数据协议和真机验收见 [开发文档](../../docs/WATCHOS_DEVELOPMENT.md)。

2026-10-26：0.2.0（2）网页扫码绑定已部署，Series 7 / watchOS 26.6 安装清单已核验新版。远程启动被手表当前系统状态拒绝，需要解锁并手动打开；真实相机扫码仍待验收。尚未读取或上传个人健康数据。

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
2. 为 target 选择自己的唯一 bundle ID，确认 HealthKit capability。本机已配置 `com.example.opengym.watchsync.watchkitapp`；其他开发者需换成自己的 ID 和团队。
3. 在 Xcode Device Hub（或 Devices and Simulators）连接已配对的手表及 iPhone，按提示开启开发者模式。
4. 选择 watchOS 26.6 真机后 Run。SDK 27 不要求实体手表升级到 27；最低版本为 26.0。

## 首次使用

点击“连接 OpenGym”，手表自动向预设的 `https://gym.example.com` 申请二维码。手机相机扫码，在网页登录、核对手表短码并确认；手表保持 OpenGym 在前台，自动保存账户与独立设备凭证。无需输入账户 ID 或复制上传凭证。绑定本身不请求 HealthKit 读取权限。

二维码 5 分钟过期；断线后可“继续等待”，过期则“重新生成”。关闭页面/进入后台暂停轮询，重新打开可恢复。网页“睡眠与恢复 → 管理已连接的手表”可输入短码或单独撤销设备。手表“更换服务器”及“高级手动配置”仍可使用；手动配置兼容 `ogh_`、`ogd_`、`ogw_`，不会自动轮换旧凭证。

**上线顺序**：先部署网页和 API，再安装 0.2.0 手表版。正式 API/Web 已于 2026-10-26 更新，实体手表也已更新为 0.2.0（2）。详见 [扫码绑定协议与验收](../../docs/WATCHOS_QR_PAIRING_DESIGN.md)。

保存后：

- **检查本机数据**：请求 HealthKit 读取授权，查看最近 7 天的五类数据；每类上限 500，截断时显示 `500+`。配置保存后可离线检查。
- **立即同步**：仅上传睡眠、静息心率及 HRV。启动即离线时，最多暂存一页睡眠数据（也可能是零样本页）；已有待传批次不会被覆盖。联网后重新校验凭证，再重试原批次、继续其余指标。
- **连接设置 → 解除连接**：取消操作，清除本机凭证、游标、诊断和待传批次；服务器历史和共用凭证不变。

手表需有可用互联网。OPPO 热点、蜂窝联网、真实健康数据、watchOS 26.6 权限行为仍需真机验收。
当前没有后台自动同步或训练心率关联上传；删除事件暂不转发服务器，避免误删被手表清理的历史。
空结果不能证明已授权或数据完整。模拟器启动与编译成功也不证明真机上传通过。
