# Cloudflare 接入与部署说明

2026-10-26：按用户指定的官方说明 `https://developers.cloudflare.com/agent-setup/prompt.md` 完成 Codex 技能安装和 MCP 注册。

- 19 个官方技能安装至用户 `.codex/skills/`。使用 Codex 技能安装器按官方仓库逐项安装，未覆盖已有技能。
- `cloudflare` MCP 配置已注册到用户 `.codex/config.toml`，地址 `https://mcp.cloudflare.com/mcp`。
- MCP OAuth 回调报错：`Authorization server response missing required issuer: expected https://mcp.cloudflare.com`。尚未认证成功，不关闭或绕过 issuer 校验；不要求用户反复授权。OpenAI 官方要求返回与发现元数据一致的 `iss`：https://developers.openai.com/plugins/build/auth 。
- Wrangler OAuth 已成功；无需 MCP 即可执行当前项目部署。未安装可选 beta `cf` CLI，也未修改全局 AGENTS.md。

## 资源隔离

仓库 `liuxiangdahai/huideng-calendar-trial` 为私有。Cloudflare 为用户自己的账号；两套 D1、两套 Worker 分别命名 `huideng-calendar-acceptance` / `huideng-calendar-trial`。Pages 项目为 `huideng-calendar-trial`，默认域名。免费方案优先；未启用付费。

`deployment.local.json` 包含本机实际资源标识并已忽略；复制 `deployment.example.json` 可配置其他账号。管理凭证、OAuth 凭证和随机限流盐不写入代码。

2026-10-27当前部署：

- 页面：https://huideng-calendar-trial.pages.dev/calendar-reminders/
- 试用健康检查：https://huideng-calendar-trial.huideng-liuxiangdahai.workers.dev/healthz
- 隔离验收健康检查：https://huideng-calendar-acceptance.huideng-liuxiangdahai.workers.dev/healthz
- 应用提交：`35f4fdbecbfb4587543edeb7f4b505c055ed3352`；Pages部署`2f1c18c7`；前后端资料SHA一致。
- 两套D1均完成0001/0002迁移，各自有独立RATE_LIMIT_SALT。本次使用已授权Wrangler首发；未启用自动发布或付费。迁移和secret put均检查实际结果，不能只凭上传成功判断就绪。

## 唯一发布链路

2026-10-28：`CALENDAR_DEPLOY_ENABLED=true`，首次完整自动发布[40624756309](https://github.com/liuxiangdahai/huideng-calendar-trial/actions/runs/40624756309)成功，应用为`cd2a58ef9f90f5962a53c6e1302aa78439b4e6af`。两套Worker/D1（含0003迁移）与Pages已经更新，实际HTTPS前后端版本校验通过。Token的资源读取和Analytics读取通过，部署操作也验证所需写权限。前节35f4fdb记录为首发历史。

CPU诊断已可读取，但首批p95=65.549ms，未达到8ms目标。流水线完成不代表性能、免费额度或试用邀请门槛完成；不自动付费。仅更新docs或README不会重新发布应用。

`.github/workflows/calendar-trial.yml`：检查 → 三引擎浏览器回归 → 隔离 Worker/D1 → 隔离远端联调 → 试用 Worker/健康检查 → Pages → 前后端版本校验。

初期 `CALENDAR_DEPLOY_ENABLED` 不开启，避免配置未就绪自动部署。GitHub Actions 需要单独的账号 API Token；不把会过期的本机 OAuth 凭证复制到 CI。配置：

- Secrets：`CLOUDFLARE_API_TOKEN`、`CALENDAR_DEPLOY_CONFIG`。
- Variables：`CLOUDFLARE_ACCOUNT_ID`、`CALENDAR_DEPLOY_ENABLED`。
- Worker secret：分别配置独立的 `RATE_LIMIT_SALT`，通过 Wrangler 标准输入传递，不放命令参数。
- 权限限定该账号所需的 Workers Scripts、D1、Cloudflare Pages，不使用 Global API Key。配置后再启用流水线。

手动首次部署也使用同一构建产物及顺序；不配置另一路 Cloudflare Git 自动发布。对试用环境只做只读版本健康检查，所有破坏性流程与通知测试在隔离环境执行。

### 一次性配置自动发布令牌

2026-10-28：用户已配置`CLOUDFLARE_API_TOKEN`，已通过GitHub仅核对名称存在；`CALENDAR_DEPLOY_CONFIG`和`CLOUDFLARE_ACCOUNT_ID`也已就绪。实际权限以Actions只读预检和后续隔离发布结果为准。以下步骤留作维护说明，不需要重复创建令牌。

1. 打开[Cloudflare API令牌](https://dash.cloudflare.com/profile/api-tokens)，选择创建令牌、创建自定义令牌。名称可填`huideng-calendar-trial-ci`。
2. 添加四项账户权限：`Workers Scripts — Edit`、`D1 — Edit`、`Cloudflare Pages — Edit`、`Account Analytics — Read`。资源限制为本项目所在的个人Cloudflare账户；不添加DNS、域名或计费权限。
3. 检查摘要并创建。将令牌粘贴到[本仓库新建Actions Secret](https://github.com/liuxiangdahai/huideng-calendar-trial/settings/secrets/actions/new)，Name填`CLOUDFLARE_API_TOKEN`，Secret填令牌，然后保存。不要把令牌发到聊天或写入源码。
4. 回复“已配置”。后续只核对Secret是否存在，通过隔离联调和指标读取验证权限，再启用既定发布流程。

依据：[Cloudflare创建令牌](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)、[Account Analytics读取权限](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)。如果控制台权限选项名称不同，记录选项名称再核对，不改用全局API Key。

## 回滚与恢复

0003迁移为旧订阅增加可空创建恢复摘要和唯一索引，不更换已有管理凭证、订阅地址或日程UID。新客户端用同一随机创建标识重试，七天内恢复同一份订阅；过期、已停用或盐轮换时明确报错。`RATE_LIMIT_SALT`的轮换会使未完成创建无法通过该标识恢复，但已经保存的管理凭证继续有效；不要随意轮换。服务器仅保留恢复标识和管理凭证的摘要。

保留已发布提交与构建记录。应用可重新部署上一兼容提交；不删除稳定 Worker 地址、不清空订阅数据库、不倒退已发布 SEQUENCE。数据库恢复演练必须使用新隔离库；验证设置、UID、版本和取消记录后，再提出生产恢复步骤。当前尚未完成回滚与恢复演练。
