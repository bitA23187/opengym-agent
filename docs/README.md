# openGym documentation

**本扩展部署入口：[给 AI Agent 的部署与修改指南](AGENT_DEPLOYMENT.md)**。上游自托管文档用于网络配置参考，扩展安装命令以此入口为准。

Pick the part that matches what you're doing. If you just have a question, try the
[FAQ](FAQ.md) first.

## Using the app

| Guide | Read it when |
|---|---|
| [FAQ](FAQ.md) | You have a quick question: iPhone, cost, where your data goes, AI, the exercise media |
| [Phone app](MOBILE.md) | You want the Android APK or the iPhone options, or to connect the app to your own server |
| [Lightweight Android development](ANDROID_DEVELOPMENT.md) | Build Android on this Mac without Android Studio or an emulator |
| [Importing data](DATA_IMPORTS.md) | You're coming from FitNotes, Strong, Hevy or Apple Health, or sharing a plan with someone |
| [Apple 健康心率同步](APPLE_HEALTH.md) | 用 iPhone 快捷指令将心率关联到训练，在网页查看曲线 |
| [iPhone 原生 HealthKit 同步](HEALTHKIT_NATIVE_SYNC.md) | iOS App 原生增量同步、后台交付与真机验收边界 |
| [饮食与日常健康](NUTRITION_DAILY_HEALTH.md) | 饮食、睡眠、静息心率和 HRV 的数据与同步 |
| [watchOS 开发](WATCHOS_DEVELOPMENT.md) | 独立手表同步端、构建和安装 |
| [AI coach](AI_COACH.md) | Your instance has the coach switched on and you want to know what it sees and can change |

The [live demo](https://opengym.ch/demo/) is the real app with example data, nothing
to install.

## Hosting it

| Guide | Read it when |
|---|---|
| [Self-hosting](SELF_HOSTING.md) | You're setting up an instance. Start here: running it, passkeys and HTTPS, users, backups, updates, troubleshooting |
| [HTTPS at home](SELF_HOSTING_HTTPS.md) | You want valid certificates on your LAN without exposing the server to the internet |
| [Kubernetes](SELF_HOSTING_KUBERNETES.md) | You run a cluster instead of Docker Compose |
| [AI coach](AI_COACH.md) | You're deciding whether to turn the coach on, and with which provider |
| [Private ChatGPT Plugin](PRIVATE_PLUGIN.md) | You want an Agent to read training, review progress, and preview confirmed plan or history edits |
| [Multi-user Plugin](MULTI_USER_PLUGIN.md) | Account isolation and connecting friends through their own OAuth grants |
| [Plugin capabilities](PLUGIN_CAPABILITIES.md) | Training context, notes, body metrics and client compatibility |
| [Plugin upgrades](PLUGIN_UPGRADES.md) | Preserve extensions when upgrading upstream |
| [MCP server](../mcp/README.md) | You want Claude Desktop, Cursor or another AI client to read your training history |
| [NixOS](NIX.md) | You run NixOS and want openGym native — flake packages and a NixOS module, no Docker |
| [Security](../SECURITY.md) | You host it for other people, or want to report a vulnerability |

All settings live in `.env`; [`.env.example`](../.env.example) explains each one, and the
[README](../README.md#quick-start) has the full table.

## Working on the code

| Guide | Read it when |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Before your first pull request: setup, guidelines, what CI checks |
| [CLAUDE.md](../CLAUDE.md) | You want the architecture in one page (written for Claude Code, useful for people too) |
| [Sharing and privacy](SHARING.md) | Share a fixed source version and maintain the sanitized repository |
| [Deployment and maintenance](OPERATIONS.md) | Build, validate, deploy and understand local-only evidence |
| [HTTP API](API.md) | You're touching routes; the OpenAPI spec is the source of truth |
| [Roadmap](../ROADMAP.md) | You want to know what's planned and where your idea fits |
| [Changelog](../CHANGELOG.md) | You want to know what changed in a release |

Design notes for specific features, kept next to the code they describe:

| Note | Covers |
|---|---|
| [Set types](dev/SET_TYPES.md) | Drop sets and rest-pause: the set-row model and how totals are counted |
| [Workout views](dev/LIST_VIEW.md) | The cards, list and compact layouts of the workout screen |
| [Combine routines](dev/COMBINE_ROUTINES.md) | Spec for running more than one routine in a session |
| [Sleep design](SLEEP_DESIGN.md) | Stages, timelines and 7/30 day overview |
| [Heart-rate analysis](HEART_RATE_ANALYSIS.md) | Heart-rate metrics and missing-data rules |
| [Watch pairing](WATCHOS_QR_PAIRING_DESIGN.md) | QR pairing protocol and acceptance checks |
| [Watch upload design](APPLE_WATCH_UPLOAD_RESEARCH.md) | Independent Watch sync capabilities and limitations |

## Still stuck?

Ask on the [Discord](https://discord.gg/e62jY6fwVb) or in
[Discussions](https://github.com/DuarteSantos8/openGym/discussions). If something in these docs was
wrong or missing, that's worth an issue too.
