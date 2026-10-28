# 慧灯藏历试用站

独立试用项目：Cloudflare Pages 前端、Workers 服务和 D1 匿名订阅存储。原慧灯 Hugo 网站不在此仓库，也不会由此仓库发布。

项目当前处于技术验收阶段。真实手机通知、国内网络和七天试用必须分别取得证据，浏览器模拟不能代替。

当前技术验收站：[打开慧灯藏历](https://huideng-calendar-trial.pages.dev/calendar-reminders/)。发布应用提交`35f4fdb`；代码检查、三引擎浏览器检查及同版本隔离云端生命周期通过。GitHub自动部署仍待专用Cloudflare API Token，首发使用Wrangler。冷启动长任务、云端CPU及真实设备等未完成项见验收台账。

## 本地开发

需要 Node.js 24。安装后运行：

```sh
npm ci
npm run build:local
npm test
npm run test:browser
```

正式前端源码在 `static/calendar-reminders/`；`tools/calendar/release-build.mjs` 是唯一产品构建入口。输出 `dist/site/` 供 Pages 或后续 Hugo 接入，`dist/worker/` 供 Worker 部署，`dist/藏历日历.html` 为同源码离线文件。离线文件不会伪造订阅成功。

## 产品约定

- 初次访问不预选；快捷方案选择 1、2 或 54 项。“全部修行日”只开启两项荟供提醒，其余仅显示。
- 藏历 PRO 负责换算，佛慧法语决定节日原名与明确安排。未确认的法会、天象不按旧年日期推算。
- 全天日程与提醒分开；设备决定“今天”，提醒时区保存用户选择。
- 免登录管理。管理凭证与只读日历凭证分开，修改沿用原订阅地址。
- iPhone 提供原生订阅入口；Google 通过电脑网页添加；其他手机按实际能力订阅或一次性导入。

执行状态、发布门槛与证据入口见 `docs/calendar-execution-plan.md`。来源与许可见 `docs/calendar-source-licenses.md`。
