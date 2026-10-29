# Cloudflare 接入与部署说明

本轮维护日期：2026-10-29。下述 Pages 统一入口为本次实施配置；新版本是否已发布、线上是否通过，以执行计划中的提交与验收证据为准。资源创建、代码完成及历史流水线成功都不能代替本轮发布验证。

2026-10-26：按用户指定的官方说明 `https://developers.cloudflare.com/agent-setup/prompt.md` 完成 Codex 技能安装和 MCP 注册。

- 19 个官方技能安装至用户 `.codex/skills/`。使用 Codex 技能安装器按官方仓库逐项安装，未覆盖已有技能。
- `cloudflare` MCP 配置已注册到用户 `.codex/config.toml`，地址 `https://mcp.cloudflare.com/mcp`。
- MCP OAuth 回调报错：`Authorization server response missing required issuer: expected https://mcp.cloudflare.com`。尚未认证成功，不关闭或绕过 issuer 校验；不要求用户反复授权。OpenAI 官方要求返回与发现元数据一致的 `iss`：https://developers.openai.com/plugins/build/auth 。
- Wrangler OAuth 已成功；无需 MCP 即可执行当前项目部署。未安装可选 beta `cf` CLI，也未修改全局 AGENTS.md。

## 资源隔离

仓库 `liuxiangdahai/huideng-calendar-trial` 为私有。Cloudflare 为用户自己的账号；Pages、Worker、D1 各有两套，分别命名 `huideng-calendar-acceptance` / `huideng-calendar-trial`。验收 Pages 项目已创建；新版本通过发布验证前不能假定动态接口已启用。使用默认域名、免费方案；不自动开通付费。

| 环境 | 唯一公开入口 | 内部绑定与数据库 |
|---|---|---|
| 隔离验收 | `https://huideng-calendar-acceptance.pages.dev` | 同名 Worker 与独立验收 D1 |
| 技术试用 | `https://huideng-calendar-trial.pages.dev` | 同名 Worker 与独立试用 D1 |

页面位于 `/calendar-reminders/`，公开接口为 `/api/subscriptions`、`/api/subscriptions/{id}`、`/calendar/{token}.ics` 和 `/healthz`。网页与日历应用均使用该环境的 Pages HTTPS 地址。Pages 通过 `CALENDAR_SERVICE` 内部服务绑定调用 Worker，不向客户端跳转到 `workers.dev`。Worker 的诊断地址仅用于发布后的只读健康检查。

`deployment.local.json` 包含本机实际资源标识并已忽略；复制 `deployment.example.json` 可配置其他账号。管理凭证、OAuth 凭证和随机限流盐不写入代码。

每个环境分别配置 `siteOrigin`、`publicApiOrigin`、`workerOrigin`、`pagesProjectName`、`workerName`、`databaseName`、`databaseId`。前两个字段必须是该环境同一个 Pages 源站，第三个字段为对应 Worker 的 HTTPS 诊断源站；网址不含路径或结尾参数。两个数据库 UUID 必须不同。示例中的 `YOUR-SUBDOMAIN` 与数据库占位值须替换为本人账号真实资源。旧的顶层 `siteOrigin` / 环境 `apiBaseUrl` 配置不再使用。

构建会同时校验两套配置，拒绝验收绑定试用 Worker、相同数据库 UUID 或跨环境网页来源。`PUBLIC_BASE_URL` 写入对应 Pages 地址，因此新订阅返回同源 `feedUrl`。本轮没有实际用户，不迁移旧测试订阅，不自动清空数据库；所有验收重新创建测试订阅。

### 历史基线（不代表本轮已部署）

2026-10-27 首发记录：

- 页面：https://huideng-calendar-trial.pages.dev/calendar-reminders/
- 试用健康检查：https://huideng-calendar-trial.huideng-liuxiangdahai.workers.dev/healthz
- 隔离验收健康检查：https://huideng-calendar-acceptance.huideng-liuxiangdahai.workers.dev/healthz
- 应用提交：`35f4fdbecbfb4587543edeb7f4b505c055ed3352`；Pages部署`2f1c18c7`；前后端资料SHA一致。
- 两套D1均完成0001/0002迁移，各自有独立RATE_LIMIT_SALT。本次使用已授权Wrangler首发；未启用自动发布或付费。迁移和secret put均检查实际结果，不能只凭上传成功判断就绪。

## 唯一发布链路

历史记录，2026-10-28：`CALENDAR_DEPLOY_ENABLED=true`，首次完整自动发布[40624756309](https://github.com/liuxiangdahai/huideng-calendar-trial/actions/runs/40624756309)成功，应用为`cd2a58ef9f90f5962a53c6e1302aa78439b4e6af`。当时两套 Worker/D1（含 0003 迁移）与单一 Pages 更新，HTTPS 前后端版本校验通过。该记录不含本轮新增的验收 Pages 和动态网关。Token 当时的资源读取、Analytics 读取和部署写入通过；本轮继续预检。

历史首批 CPU p95=65.549ms，未达到 8ms 目标。本轮须重新分别测量 Worker 与 Pages 动态入口，不能沿用历史结果标通过。流水线完成不代表性能、免费额度或试用邀请门槛完成；不自动付费。仅更新 docs 或 README 不会重新发布应用。

`.github/workflows/calendar-trial.yml` 是唯一发布链路：检查及三引擎浏览器回归 → 验收 Worker/D1 → Worker 健康检查 → 验收 Pages → 前端／网关／Worker 版本验证 → 经验收 Pages 的完整订阅联调 → 指标采集 → 试用 Worker/D1 → 试用 Worker 健康检查 → 试用 Pages → 版本与同源配置复核。自动写入只发生在验收 Pages；试用环境只运行只读发布检查。

初期 `CALENDAR_DEPLOY_ENABLED` 不开启，避免配置未就绪自动部署。GitHub Actions 需要单独的账号 API Token；不把会过期的本机 OAuth 凭证复制到 CI。配置：

- Secrets：`CLOUDFLARE_API_TOKEN`、`CALENDAR_DEPLOY_CONFIG`。
- Variables：`CLOUDFLARE_ACCOUNT_ID`、`CALENDAR_DEPLOY_ENABLED`。
- Worker secret：分别配置独立的 `RATE_LIMIT_SALT`，通过 Wrangler 标准输入传递，不放命令参数。
- 权限限定该账号所需的 Workers Scripts、D1、Cloudflare Pages，不使用 Global API Key。配置后再启用流水线。

不配置另一条 Cloudflare Git 自动发布，不手动上传旧 HTML 绕过检查。代码推送后由上述 Actions 发布；`remote-acceptance` 备用任务只检查已部署版本，不发布代码。其 `CALENDAR_ACCEPTANCE_URL` 必须为验收 Pages，`CALENDAR_ACCEPTANCE_VERSION` 为已部署的完整提交编号。

### 正式构建与 Pages 绑定

线上构建使用 `node tools/calendar/build-environment.mjs acceptance` 或 `trial`。构建读取 `deployment.local.json`（CI 从 `CALENDAR_DEPLOY_CONFIG` Secret 写入），检查发布源文件与提交一致。网关源码、路由生成器和流水线也纳入检查；页面、网关、Worker 注入同一个提交和资料摘要。单文件 HTML 与线上共用前端源码，但离线版本不冒充可用的在线服务。

- `dist/<环境>/site/`：HTML、CSS、JS、图片及根目录 `_worker.js` / `_routes.json`。只有 `/api/*`、`/calendar/*`、`/healthz` 调用 Pages Functions，其余静态文件直接由 Pages 提供。
- `dist/<环境>/worker/`：后台及迁移、Worker 配置，不能作为静态资源上传。
- `dist/<环境>/pages/wrangler.json`：`pages_build_output_dir: "../site"`；`env.production` 绑定同名 Worker，`env.preview` 不绑定任何日历服务。
- Worker 配置的 `PUBLIC_BASE_URL` 与 Pages 网关的公开源站均为该环境 Pages 地址；生产分支为 `main`。预览地址不能用于创建订阅。

已用本机 Wrangler 4.151.3 配置读取验证生产绑定、空预览绑定及相对目录。Pages CLI 不接受自定义 `--config` 路径；Actions 使用以下命令从生成配置目录发布：

```sh
npx wrangler pages deploy --cwd dist/acceptance/pages --project-name huideng-calendar-acceptance --branch main
npx wrangler pages deploy --cwd dist/trial/pages --project-name huideng-calendar-trial --branch main
```

以上是流水线内的发布命令说明，并非要求同时另行手动执行。网关保留授权、Origin、幂等标识、ETag／304 和 HEAD，直接传递日历内容；未绑定、版本不符、意外重定向或 HTML 响应返回中文错误，不暴露个人地址。管理响应禁止公共缓存，动态 HTTPS 响应含 HSTS。只读 `/healthz` 对齐版本后才返回正常，并包含 `gatewayVersion`；不得输出管理或订阅凭证。

### 一次性配置自动发布令牌

2026-10-28：用户已配置`CLOUDFLARE_API_TOKEN`，已通过GitHub仅核对名称存在；`CALENDAR_DEPLOY_CONFIG`和`CLOUDFLARE_ACCOUNT_ID`也已就绪。实际权限以Actions只读预检和后续隔离发布结果为准。以下步骤留作维护说明，不需要重复创建令牌。

1. 打开[Cloudflare API令牌](https://dash.cloudflare.com/profile/api-tokens)，选择创建令牌、创建自定义令牌。名称可填`huideng-calendar-trial-ci`。
2. 添加四项账户权限：`Workers Scripts — Edit`、`D1 — Edit`、`Cloudflare Pages — Edit`、`Account Analytics — Read`。资源限制为本项目所在的个人Cloudflare账户；不添加DNS、域名或计费权限。
3. 检查摘要并创建。将令牌粘贴到[本仓库新建Actions Secret](https://github.com/liuxiangdahai/huideng-calendar-trial/settings/secrets/actions/new)，Name填`CLOUDFLARE_API_TOKEN`，Secret填令牌，然后保存。不要把令牌发到聊天或写入源码。
4. 回复“已配置”。后续只核对Secret是否存在，通过隔离联调和指标读取验证权限，再启用既定发布流程。

依据：[Cloudflare创建令牌](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)、[Account Analytics读取权限](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)。如果控制台权限选项名称不同，记录选项名称再核对，不改用全局API Key。

## 回滚与恢复

0003迁移为旧订阅增加可空创建恢复摘要和唯一索引，不更换已有管理凭证、订阅地址或日程UID。新客户端用同一随机创建标识重试，七天内恢复同一份订阅；过期、已停用或盐轮换时明确报错。`RATE_LIMIT_SALT`的轮换会使未完成创建无法通过该标识恢复，但已经保存的管理凭证继续有效；不要随意轮换。服务器仅保留恢复标识和管理凭证的摘要。

保留已发布提交、两套构建配置和发布记录。新 Pages 订阅发放后，回滚版本必须包含 `_worker.js`、`_routes.json`、正确服务绑定及 `/calendar/*` 动态接口；不能退回只有静态页面的历史版本。Pages 项目名称和公开路径保持不变，Worker 与网关必须同版本。选定兼容源码后通过唯一流水线重新构建、先在隔离环境演练，再进行试用发布；无兼容版本时发布修复，不能用旧静态站顶替。

回滚应用不回退或清空用户数据库，不撤销已应用的兼容迁移，不倒退已发布 `SEQUENCE`，也不随意变更 `RATE_LIMIT_SALT`。数据库恢复先导入新建的隔离库，再验证设置、固定地址、UID、版本及取消记录；演练不能改写试用库。发放新订阅前的历史测试数据无需迁移，仍不自动删除。本轮回滚与恢复演练尚待取得证据。
