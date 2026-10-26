# 个人藏历订阅服务

Hugo 继续提供页面；Cloudflare Worker 提供匿名设置管理和固定地址的 ICS，D1 保存设置及已发布日程。网页修改设置后，原订阅地址继续有效。日历客户端按自身节奏刷新，保存成功不表示手机已经刷新。

本服务不访问用户手机日历、不保存姓名或邮箱、不发送邮件或推送。Google OAuth 不在本版范围内。

## 接口与状态

| 接口 | 用途 |
| --- | --- |
| `POST /api/subscriptions` | JSON `{settings}`；创建后返回 `{id, feedUrl, manageToken, settings, revision}`。管理凭证仅此时返回。 |
| `GET /api/subscriptions/:id` | `Authorization: Bearer <manageToken>`；读取设置、固定 `feedUrl`、`revision`、`disabled`。 |
| `PATCH /api/subscriptions/:id` | 同一管理凭证；JSON `{settings, revision}`。成功增加设置版本，冲突返回 409。完全相同的设置不增加版本。 |
| `DELETE /api/subscriptions/:id` | 停用订阅、立即清除已存设置，并取消已发布日程。重复操作安全。停用后不可恢复，需创建新订阅。 |
| `GET /calendar/:feedToken.ics` | 只读订阅；支持 `HEAD`、`ETag`、`If-None-Match`。无需登录、Cookie 或 CORS 凭证。 |

`settings` 使用页面共享的 v2 严格校验：时区及每个节日的 `off / display / remind`、一至两次提醒。未知条目、无效时间、无效时区均拒绝，缺少的有效目录条目填为不添加。旧订阅遇到目录新增条目不会自动开启；目录撤销条目后会取消其已发布日程。

设置以用户选择的 IANA 时区计算提醒，全天日期不随时区移动。服务根据当前时间生成过去 90 天至未来 24 个月的日程，前端不必要求选择开始日期或期限。超出日期引擎支持范围或引擎出错时返回服务暂不可用，不发布空日历冒充成功。

夏令时采用日历兼容规则：秋季回拨出现两次相同时刻时，使用第一次；春季跳时导致某个时刻不存在时，按跳过时长顺延。例如温哥华秋季的 01:30 只提醒一次，春季不存在的 02:30 顺延为 03:30。这样滚动窗口纳入未来的夏令时转换日时，原本有效的长期订阅不会突然失败。

## 发布一致性与取消

- 按日期引擎提供的稳定 UID 保存日程；改名、改公历日期、改提醒不更换 UID。
- 规范化事件内容取 SHA-256；仅内容变化或状态变化增加 `SEQUENCE` 并更新 `DTSTAMP`、`LAST-MODIFIED`。反复刷新不会产生新版本。
- 取消选择、数据撤销或退出滚动窗口的旧条目以同 UID 的 `STATUS:CANCELLED` 保留 90 天，且不带提醒。
- 90 天后从 feed 隐去取消条目；活跃订阅只保留其 UID、版本和时间记录，不保留旧事件内容。因此再次选择仍能增加版本，避免客户端误认为是旧数据。
- 停用订阅时清除设置，已发布日程最多保留 90 天用于向客户端传递取消；定时清理随后删除这些日程。最小的订阅墓碑保留，旧地址继续返回空日历。
- D1 事务批处理和版本条件避免并发刷新覆盖较新的设置、倒退事件版本或写出重复 UID。
- 服务使用 `private, max-age=300, must-revalidate`；缓存允许最多五分钟的旧响应，日历自身刷新还可能更久，不承诺实时同步。

立即停止已有手机通知，应同时在手机日历中取消该订阅。网站无法强制清除客户端尚未刷新的缓存。

## 隐私与安全

订阅地址中的随机 256 位 token 只允许读取。管理 token 另行生成、只保存 SHA-256，不能用订阅 token 修改设置。ICS 不包含管理 token 或管理链接。管理接口响应禁用缓存；所有响应禁止索引并设置 `Referrer-Policy: no-referrer`。

持有订阅地址的人仍可读取该日历，所以该地址应视为私人分享地址。持有管理链接的人可修改或停用此订阅。丢失管理链接且本机数据也被清除时，本版无法找回；可创建新订阅，并在手机移除旧订阅。

管理 token 应由前端保存在本机，并可经管理链接的 URL fragment 恢复；不应放入查询参数或访问日志。服务的日志不输出请求地址、凭证、设置或 SQL 错误；Wrangler 示例关闭请求观测日志。账号所有者仍应核查平台访问日志保留设置。

写入接口只接受明确列入 `ALLOWED_ORIGINS` 的 Origin；拒绝 `null`、未配置来源及缺少 Origin 的写入。CORS 不使用通配符或 credentials。只读 feed 允许没有 Origin 的日历客户端；其安全性来自随机地址。

设置请求最多 64 KiB。生产创建接口按 Cloudflare 提供的客户端地址限制为每天 20 次；只存使用私有盐和日期生成的摘要，计数在两天后清除。`RATE_LIMIT_SALT` 必须作为 Worker secret 配置，不应提交仓库。生产公网流量更大时，可在平台上增加 WAF 限额。

## 本地运行与测试

Node.js 24 提供真正的 SQLite。`service/calendar/local.mjs` 导出：

```js
createLocalService({databasePath, origin, now?})
// => {fetch(Request): Promise<Response>, close()}
```

该本地适配与生产执行相同的处理器、参数化 SQL 和事务逻辑。SQLite 数据库保存在调用方指定路径；仅接受 localhost / 127.0.0.1 / ::1 的服务地址。开发服务器需把 `/api/*` 和 `/calendar/*` 转发给此实例，并在退出时调用 `close()`。

```sh
npm run test:service
```

集成测试使用临时磁盘 SQLite，并使用共享的设置校验和 ICS 序列化、独立 `ical.js` 解析器。覆盖持久化、凭证隔离、跨域和输入拒绝、稳定地址、缓存、修改冲突、日期更正、取消/恢复/清理、动态窗口、并发请求、限额和事务回滚。日期引擎本身由日历测试单独验证。

端到端回归还使用真实藏历 PRO 和目录验证 2030/2031 年的滚动窗口，以及从 2026-10-21 推进到 2026-11-07 后新纳入的 2028-11-05 温哥华重叠时刻：当天 01:30 对应一次 08:30 UTC 提醒，feed 保持可读。

如需直接验证 Cloudflare 本地 D1：

```sh
npx wrangler d1 migrations apply huideng-calendar-local --local --config service/calendar/wrangler.local.toml
npx wrangler dev --local --config service/calendar/wrangler.local.toml
```

本地模拟配置使用 `http://127.0.0.1:8787`，明确允许该地址及页面预览的 `http://127.0.0.1:4173`。该配置不可部署到生产。

服务启动后，在另一终端运行 `node tools/calendar/smoke-service.mjs`，检查实际 HTTP、D1 持久化、默认及全选目录、双提醒、缓存与撤销。脚本仅接受本机地址，不打印订阅凭证，并在结束时停用测试订阅。

## 部署

源码不会自动创建云账号、绑定域名或发布服务。部署需要小组可控制的 Cloudflare 账号、D1 数据库和 HTTPS 服务域名。

1. 从 `service/calendar/wrangler.example.toml` 复制一份未跟踪的 `wrangler.toml`，填写实际 Worker 名称、D1 ID 和自定义域名。
2. 设置 `PUBLIC_BASE_URL` 为服务的 HTTPS origin；`ALLOWED_ORIGINS` 填实际网站 origin，多个来源以逗号分隔。不要填写 `*`，不要在生产设置 `ALLOW_LOCAL_DEV`。
3. 通过 `wrangler secret put RATE_LIMIT_SALT --config service/calendar/wrangler.toml` 配置随机私有盐。
4. 使用相同配置执行远端 D1 migration，再部署 Worker；将网站的服务配置指向这个 HTTPS 地址。
5. 以实际网站 Origin 完成创建、编辑、取消和订阅刷新验收。选择一台 iPhone、Google Calendar 和至少一种国内 Android 日历进行真机测试。
6. 定期构建并核对节日资料，再一起发布日期资料及 Worker；共享引擎和资料在构建时打包进 Worker，线上请求不抓取第三方网页。

账号和域名就绪后的命令顺序（从仓库根目录运行；生产配置不得提交仓库）：

```sh
npx wrangler login
npx wrangler d1 create huideng-calendar
# 复制 wrangler.example.toml 为 service/calendar/wrangler.toml，填写返回的 ID、域名和允许的网站来源
npx wrangler secret put RATE_LIMIT_SALT --config service/calendar/wrangler.toml
npx wrangler d1 migrations apply huideng-calendar --remote --config service/calendar/wrangler.toml
npx wrangler deploy --dry-run --config service/calendar/wrangler.toml
npx wrangler deploy --config service/calendar/wrangler.toml
```

最后把 `static/calendar-reminders/config.json` 的 `apiBaseUrl` 填为该服务 HTTPS origin，再发布 Hugo 网站。开发版与离线体验版的本地地址不可写入生产配置。

停用的每日清理由 UTC 04:17 的 Cron 执行。建议监控服务的 5xx 比例、D1 配额和定时清理失败；监控标签只使用接口类型和状态码，不记录完整个人订阅 URL。D1 备份保留由账号所有者管理，删除设置不会抹除平台已有备份。

## 手机兼容范围

- **Apple 日历：**官方支持外部只读 ICS 订阅及订阅日历事件提醒。服务输出全天日期与自选时间的 `VALARM`；仍需实测手机的通知权限、两次提醒和刷新行为。[Apple 官方说明](https://support.apple.com/en-euro/guide/iphone/iph3d1110d4/ios)
- **Google Calendar：**官方从 URL 添加流程在电脑浏览器完成，手机 App 不支持直接新增。网址订阅不保证保留网站的逐项提醒。用户需检查 Google 提供的通知设置；其官方教程限定自有日历，不能承诺外部订阅具有相同选项。[添加订阅](https://support.google.com/calendar/answer/37100?co=GENIE.Platform%3DDesktop&hl=en) · [通知设置](https://support.google.com/calendar/answer/37242?hl=en)
- **华为：**所查官方说明确认特定 HarmonyOS 5/6 版本支持 ICS 文件导入，未证明所有机型支持任意 URL 的长期订阅。[华为说明](https://consumer.huawei.com/cn/support/content/zh-cn16070813/)
- **其他日历：**复制订阅地址与文件导入作为不同能力分别呈现。文件导入是静态快照，不能描述成订阅。OPPO、小米等仍需按实际应用版本验收。

Google 和部分客户端可能将整个日历的默认通知应用到所有事件；网站“不带提醒”的 ICS 条目不能强制关闭该客户端的默认通知。本版不宣称所有平台的自选时间或静默行为完全相同。

时区校验已扩展到全部受支持的 IANA 具名地区及别名；仍保存 v2 zone 字符串，不新增数据表或会员系统。页面与后台通过 timezones.mjs 共用2026e兼容修正，部署时应同时发布前端和Worker，避免显示偏移与实际提醒计算版本不一致。UI偏好和自行确认进度不会提交到订阅API。
