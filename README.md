# 慧灯藏历试用站

独立试用项目：Cloudflare Pages 前端、Workers 服务和 D1 匿名订阅存储。原慧灯 Hugo 网站不在此仓库，也不会由此仓库发布。

项目当前处于技术验收阶段。真实手机通知、国内网络和七天试用必须分别取得证据，浏览器模拟不能代替。

当前技术试用站：[打开慧灯藏历](https://huideng-calendar-trial.pages.dev/calendar-reminders/)。截至2026-11-05，应用`23abc3e`已通过唯一流水线发布：143项规则/服务/构建检查、60项×三引擎、143次隔离Pages链路请求及15次提醒专项请求通过。本轮统一每日藏历与快捷方案的纸色、增加轻量原创纹样、收拢连接详情；保留先复制再打开和免下载提醒测试。网页、API和ICS统一从Pages访问，内部服务绑定Worker。首次验收healthz 503后重跑成功；云端CPU p95为52.257ms，仍未达到8ms目标；前端交互p95均≤176ms，但冷启动仍有372ms长任务。网关CPU、完整真实设备和网络等门槛仍未完成。详见[当前执行计划](docs/calendar-execution-plan.md)、[本轮证据](docs/evidence/ornament-ui-20261105/README.md)和[提醒验收](docs/calendar-reminder-acceptance.md)。

2026-11-08：完成“经页·香布”整体界面改版与佛慧法语资料比对工具，设计说明与证据见[本轮证据](docs/evidence/pecha-ui-20261108/README.md)，发布状态以执行计划为准。

请先读[项目交接](docs/calendar-collaboration-handoff.md)及[本轮UI/UX审阅建议](docs/calendar-uiux-review.md)。设计建议尚未实施，不改变已有产品约定。

接手维护先读 [`docs/maintainer-handbook.md`](docs/maintainer-handbook.md)（一页）。

## 本地开发

需要 Node.js 24。安装后运行：

```sh
npm ci
npm run build:local
npm test
npm run test:browser
```

正式前端源码在 `static/calendar-reminders/`；`tools/calendar/release-build.mjs` 是唯一产品构建入口。输出 `dist/site/` 供 Pages 或后续 Hugo 接入，`dist/worker/` 供 Worker 部署，`dist/藏历日历.html` 为同源码离线文件。

## 产品约定

- 初次访问不预选；快捷方案选择 1、2 或 54 项。“全部修行日”只开启两项荟供提醒，其余仅显示。
- “每日藏历日期”是默认关闭的独立选项，可单独订阅或与修行日共用原地址。每天一条全天日程、不设置提醒；重日、闰月和缺日共用藏历 PRO 判断。换方案保留，清空关闭。
- 藏历 PRO 负责换算，佛慧法语决定节日原名与明确安排。未确认的法会、天象不按旧年日期推算。
- 全天日程与提醒分开；设备决定“今天”，提醒时区保存用户选择。
- 免登录管理。管理凭证与只读日历凭证分开，修改沿用原订阅地址。
- Apple提供点击打开及iPhone/Mac手动步骤；微信先转浏览器打开。Google通过电脑添加，Outlook提供网页/经典版步骤，其他日历按实际能力订阅或一次性导入。详见[中文使用说明](docs/calendar-user-guide.md)。

执行状态、发布门槛与证据入口见 `docs/calendar-execution-plan.md`。来源与许可见 `docs/calendar-source-licenses.md`。

官网采用导航链接接入，不复制本应用或改动官网发布流程。最新官网最小补丁及发布前检查见 [官网接入说明](docs/integration/README.md)。
