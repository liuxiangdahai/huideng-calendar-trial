# Cloudflare 接入与部署说明

2026-10-26：按用户指定的官方说明 `https://developers.cloudflare.com/agent-setup/prompt.md` 完成 Codex 技能安装和 MCP 注册。

- 19 个官方技能安装至用户 `.codex/skills/`。使用 Codex 技能安装器按官方仓库逐项安装，未覆盖已有技能。
- `cloudflare` MCP 配置已注册到用户 `.codex/config.toml`，地址 `https://mcp.cloudflare.com/mcp`。
- MCP OAuth 回调报错：`Authorization server response missing required issuer: expected https://mcp.cloudflare.com`。尚未认证成功，不关闭或绕过 issuer 校验；不要求用户反复授权。OpenAI 官方要求返回与发现元数据一致的 `iss`：https://developers.openai.com/plugins/build/auth 。
- Wrangler OAuth 已成功；无需 MCP 即可执行当前项目部署。未安装可选 beta `cf` CLI，也未修改全局 AGENTS.md。

## 资源隔离

仓库 `liuxiangdahai/huideng-calendar-trial` 为私有。Cloudflare 为用户自己的账号；两套 D1、两套 Worker 分别命名 `huideng-calendar-acceptance` / `huideng-calendar-trial`。Pages 项目为 `huideng-calendar-trial`，默认域名。免费方案优先；未启用付费。

`deployment.local.json` 包含本机实际资源标识并已忽略；复制 `deployment.example.json` 可配置其他账号。管理凭证、OAuth 凭证和随机限流盐不写入代码。

## 唯一发布链路

`.github/workflows/calendar-trial.yml`：检查 → 三引擎浏览器回归 → 隔离 Worker/D1 → 隔离远端联调 → 试用 Worker/健康检查 → Pages → 前后端版本校验。

初期 `CALENDAR_DEPLOY_ENABLED` 不开启，避免配置未就绪自动部署。GitHub Actions 需要单独的账号 API Token；不把会过期的本机 OAuth 凭证复制到 CI。配置：

- Secrets：`CLOUDFLARE_API_TOKEN`、`CALENDAR_DEPLOY_CONFIG`。
- Variables：`CLOUDFLARE_ACCOUNT_ID`、`CALENDAR_DEPLOY_ENABLED`。
- Worker secret：分别配置独立的 `RATE_LIMIT_SALT`，通过 Wrangler 标准输入传递，不放命令参数。
- 权限限定该账号所需的 Workers Scripts、D1、Cloudflare Pages，不使用 Global API Key。配置后再启用流水线。

手动首次部署也使用同一构建产物及顺序；不配置另一路 Cloudflare Git 自动发布。对试用环境只做只读版本健康检查，所有破坏性流程与通知测试在隔离环境执行。

## 回滚与恢复

保留已发布提交与构建记录。应用可重新部署上一兼容提交；不删除稳定 Worker 地址、不清空订阅数据库、不倒退已发布 SEQUENCE。数据库恢复演练必须使用新隔离库；验证设置、UID、版本和取消记录后，再提出生产恢复步骤。当前尚未完成回滚与恢复演练。
