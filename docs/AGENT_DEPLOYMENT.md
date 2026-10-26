# 给 AI Agent 的部署与修改指南

本指南适用于 **OpenGym Agent 扩展版**。代码基于 upstream openGym 1.4.1，包含 OAuth/MCP 训练助手、饮食与日常健康、iPhone HealthKit 与独立 watchOS 同步。不是上游官方发行版。

仓库：https://github.com/bitA23187/opengym-agent 。首次交付标签：`agent-v0.1.0`。

## 0. 执行约定与完成标准

先读根目录 `AGENTS.md`、本指南、`docs/OPERATIONS.md`。先检查当前 Git 状态，保留已有修改。不要使用原维护者的服务器、账号、证书、OAuth 授权或数据；本仓库的 `example.com`、空 Apple Team 和 `com.example` 都是待替换示例。

依次完成：确认环境 → 克隆固定版本 → 创建本机配置 → 构建 → 在本机端口验收 → 创建所有者账号 → 关闭开放注册 → 配置 HTTPS → 客户端验收。只在缺少域名、目标主机权限等必需信息时向部署者提问，其余可逆准备工作继续进行。不要声称没有实际完成的验收已通过。

部署交付必须报告：源码标签与 commit、容器镜像 ID、实际服务 URL、健康检查、注册状态、数据目录与备份位置、可选功能的验收范围和已知失败。日志、账号 ID、健康数据和令牌不放进公开报告。

## 1. 环境检查

- Git；Docker Engine / Docker Desktop 与 Compose v2，足够的构建磁盘和内存。首次编译需访问 npm、Docker Hub、GHCR；低内存 VPS 可在同架构构建机编译再传镜像。
- 默认绑定 `127.0.0.1:8080`，不会直接向公网开放。远程主机可先用 SSH 本地端口转发进行初始化。
- 生产使用自己控制的 HTTPS 域名；选择域名后再注册 passkey，`RP_ID` 更改会使旧 passkey 无法使用。
- Docker 路径内会自动安装 Node 22 与锁定依赖；宿主不需要 Node。修改代码或本机运行测试时安装 Node 22。

```sh
git --version
docker version
docker compose version
```

## 2. 获取固定版本

```sh
git clone --branch agent-v0.1.0 --depth 1 https://github.com/bitA23187/opengym-agent.git
cd opengym-agent
git rev-parse HEAD
cp agent.env.example agent.env
chmod 600 agent.env
```

本仓库公开，克隆源码不需要 GitHub 登录或个人访问令牌。自己的部署凭据仍须留在本机。`--branch` 可以检出 tag，出现 detached HEAD 是预期；开始修改时另建分支：

```sh
git switch -c codex/my-change
```

`agent-v0.1.0` 固定源码，不会自动追随 `main`。Node/nginx 基础镜像仍可能更新；部署时另行记录镜像 ID，严格复现运行镜像应保留镜像归档或使用自己验证的 digest。不要重打同名标签，也不要将上游 `v1.4.1` 与扩展版标签混淆。

## 3. 本机部署扩展版

**必须显式指定 `docker-compose.agent.yml`。** 根目录默认 Compose 的预构建镜像来自上游，不包含完整扩展；`docker-compose.server.yml` 是历史拓扑示例，不能照搬。

编辑 `agent.env`：本机验证时保留 `localhost` 和 `http://localhost:8080`；时区按使用者设置。`FIRST_USER_ADMIN=1`、`INVITE_ONLY=0` 仅用于受限入口下的首次初始化。OAuth/MCP 插件在本机 HTTP 初始化阶段保持 `PLUGIN_ENABLED=0`，待 HTTPS 可用后启用；独立 AI Coach 关闭，无需模型 API key。训练与营养自动保存的用户列表保持空值。

```sh
docker compose --env-file agent.env -f docker-compose.agent.yml config --quiet
docker compose --env-file agent.env -f docker-compose.agent.yml build
docker compose --env-file agent.env -f docker-compose.agent.yml up -d
docker compose --env-file agent.env -f docker-compose.agent.yml ps
curl --fail http://localhost:8080/api/health
```

此阶段仅验证 Web/API 与账号功能；HTTP 插件构造器会拒绝非 HTTPS 的 ORIGIN，因此不要提前开启。

API 镜像从本仓库源码构建，含插件与共享训练逻辑；Web 镜像编译本仓库前端，在 upstream `opengym-web:1.4.1` 中保留 openGym 使用的动作媒体。源码包不含这些受单独许可限制的媒体，不从维护者服务器复制或热链接。构建失败时先修复 npm/GHCR/DNS/磁盘问题，不回退到上游 `latest` 冒充扩展版。

`./data` 首次启动由 API 创建，包含账户、会话密钥、训练/健康状态与插件授权；API 使用单实例写入，不能通过多副本共享此目录。首次创建所有者账号后，确认其有管理员入口，再修改 `agent.env`：

```dotenv
FIRST_USER_ADMIN=0
INVITE_ONLY=1
ALLOW_GUEST=0
```

重新执行 `up -d`，检查现有账号能登录、未持有邀请码不能注册。首次初始化过程中不要先暴露公网入口。

## 4. 生产 HTTPS

先让部署者提供自己的域名、目标主机与反向代理方案。修改 `agent.env`，示例域名必须替换：

```dotenv
RP_ID=gym.example.com
ORIGIN=https://gym.example.com
PLUGIN_ENABLED=1
```

使用自己主机上的 Caddy 等代理将 HTTPS 转发到 `127.0.0.1:8080`。例如在已配置的 Caddy 中增加：

```caddy
gym.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

如果代理在另一个容器，`127.0.0.1` 指的是那个容器，需由 Agent 根据实际 Docker 网络配置代理到 Web 服务。不要为了省事将 API 的 3000 端口暴露公网。只有网络方案需要时才设置自己的 `OPENGYM_BIND_ADDRESS`；默认继续使用回环地址。

重新执行 `up -d`。在有 Node 的机器执行 `node scripts/verify-private-plugin.mjs https://你的域名`；该探针仅读取公共元数据并验证未授权调用被拒绝，不写入训练数据，也不能代替真实 OAuth 验收。在你自己的域名运行健康探针，检查 HTTPS、passkey/密码登录、页面静态资源、动作媒体、数据保存与另一设备同步。不要在真实账号自动创建测试训练；使用部署者同意的独立测试账号。

OAuth/MCP 需要代理转发 `/.well-known/*` 与 `/api/plugin/*`，不要被额外 SSO、Basic Auth 或自定义 CORS 响应拦住。参考 [自托管说明](SELF_HOSTING.md) 的代理约束。该指南的网络说明仍适用，但安装命令以本页为准。

## 5. 按需开启客户端功能

| 功能 | 部署后还要做什么 |
|---|---|
| 浏览器 / PWA | 访问自己的 HTTPS 域名，手机添加到主屏幕；先验证跨设备同步 |
| OAuth/MCP 训练助手 | 在自己的兼容客户端连接 `https://你的域名/api/plugin/mcp`，使用自己的 openGym 账号 OAuth 授权；见 [能力范围](PLUGIN_CAPABILITIES.md)、[多用户说明](MULTI_USER_PLUGIN.md) |
| 本地 stdio MCP | 是 `mcp/` 下另一条只读连接路径，不能当作 HTTP 插件替代品；见 [mcp/README.md](../mcp/README.md) |
| iPhone HealthKit | 需 macOS、Xcode、自己的 Apple Team 与唯一 Bundle ID；构建并真机授权，不会随 Web 部署自动启用；见 [原生同步](HEALTHKIT_NATIVE_SYNC.md) |
| 独立 watchOS | 配置自己的 Team、Bundle ID，修改 `frontend/watchos/App/Info.plist` 的 `OpenGymServerURL`；空签名团队和 example 地址不会指向任何真实实例；见 [watchOS](WATCHOS_DEVELOPMENT.md) |
| iPhone 快捷指令 | 原维护者签名的二进制快捷指令不随交付分发。用 `scripts/build-*-shortcut.py` 生成，在自己的 Mac 签名后按前端下载路径安装；见 [Apple 健康](APPLE_HEALTH.md)。未自行生成前下载链接不可用，可优先使用原生 HealthKit |
| 独立 AI Coach | 此部署配置强制关闭，与 MCP 插件不同；确实需要时另读 [AI_COACH.md](AI_COACH.md)，按需求修改构建与权限后重新验证 |

当前 HTTP 插件针对 ChatGPT OAuth 回调提供支持，不保证任意 MCP 客户端均能 OAuth 登录。其他客户端先核对回调与协议能力，不能通过关闭认证、泄露管理员令牌或取消账号隔离解决兼容性。

## 6. 修改与验证

```sh
npm ci
npm ci --ignore-scripts --prefix frontend
npm ci --omit=optional --prefix api
npm ci --ignore-scripts --prefix api/plugin
npm ci --ignore-scripts --prefix mcp
TZ=UTC npm test --prefix api/plugin
TZ=UTC npm test --prefix mcp
npm run build --prefix frontend
node api/scripts/check-core-loadable.mjs
node scripts/build-api-docs.mjs --check
```

训练、进阶或历史读取逻辑修改应在纯函数旁增加有意义的测试；同时运行受影响前端/API 测试。全部测试命令与 **已有失败基线** 见 [维护指南](OPERATIONS.md)。不能把已有失败隐瞒为通过，也不要无关地升级依赖或重写同步协议。原生改动需 Xcode 构建与实体设备验收。

## 7. 备份、更新与回退

升级前记录 `git rev-parse HEAD` 和 `docker compose ... images`，保存当前 API/Web 镜像（例如 `docker image save`），备份 `agent.env` 与整个 `data/`。配置备份也属于私密数据。备份写入权限受限且不在 Git 工作区的目录；停 API 这个唯一写进程后再归档数据，并用 `trap` 或等效机制保证失败也会恢复服务。需要上传时先加密，密钥与备份分开放。

`scripts/backup-server.sh` 面向历史服务器拓扑，需要自行配置路径、Compose 文件、age 公钥和 `OPENGYM_BACKUP_REMOTE`；不要直接在新部署上执行。恢复前先在隔离目录验证可解密、可启动，不要覆盖现有训练数据。

更新：备份 → 查看新标签差异/说明 → 检出新标签（保留自己的修改分支）→ 用独立 `OPENGYM_IMAGE_TAG` 构建 → 执行 `up -d` → 重跑验收。Compose 插值变量通过同一份 `agent.env` 或明确的 shell 环境提供，例如在 `agent.env` 增加 `OPENGYM_IMAGE_TAG=agent-v0.2.0`。已有标签镜像不要被下一次构建覆盖。

回退代码优先使用保留的旧镜像和旧配置。代码回退与数据恢复分别决定；只回退代码不能逆转数据格式变化，恢复旧数据会丢失备份后记录。禁止自动使用 `down -v`、清空 `data/` 或用旧备份覆盖生产数据。

## 8. 分享前检查

只提交源码和占位示例，不提交 `agent.env`、`.env`、`data/`、备份、私钥、证书、设备凭据、Apple 签名身份、原生输出或个人日志。公开仓库的访问者可以查看可访问的历史、标签与 PR，不仅是默认分支。

发布前从干净 clone 跑构建和验收，检查 `git ls-files`、暂存内容、标签及 GitHub 分支/PR。可用 `gitleaks git . --redact` 扫描历史；校验和与测试常量需人工辨别。发现真实密钥必须撤销/轮换，删除文件或分支不能证明 GitHub 缓存、旧 clone、PR 引用已经消失。本分享仓库公开；私人归档继续保持私有，不将其历史或数据推到这里。
