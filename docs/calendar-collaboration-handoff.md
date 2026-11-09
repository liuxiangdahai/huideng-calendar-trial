# 慧灯藏历：Claude / Codex 协作交接

更新：2026-11-05。这是已有产品的交接，不是从零建站需求。开始工作时重新读取仓库状态、执行计划及线上版本；不要将本文中的历史证据当成新修改已通过。

2026-11-09补充：配色改为“雪域经卷”：暖白纸面、胭脂红（操作/选中/提醒）、青金（结构/标题/链接）、古金（细线纹饰）；中性色几乎无彩度，取消纸纹。字号统一用`--fs-*`阶梯，手机放大一级。人类接手维护看`docs/maintainer-handbook.md`。

2026-11-08补充：样式改为一套设计变量（`style.css`顶部`:root`），新增颜色、阴影、字体请加变量而不是写色值；藏式元素（香布`--shambu`、八吉祥图标`icons.mjs`）均为代码绘制，不再新增独立装饰图片。日程标签只区分“提醒/仅显示”两色，分类靠图标与文字。佛慧法语资料更新请用`tools/calendar/fohui-diff.mjs`比对手动保存的月份页，不要整份重导或自动抓取。

2026-11-06补充：动效由`motion.mjs`与`motion.css`集中维护，月份/勾选/面板效果仅由操作入口触发；不要在通用render或时钟刷新中播放。手机阅读锚点只做淡入，不移动位置；系统偏好每次动作即时查询，媒体变化监听负责取消已有动画。保留同纸底的每日藏历，禁止为动效另加彩色背景。正式构建和离线文件共享这些源码，验收记录见`docs/evidence/motion-ui-20261106/`。

## 1. 项目与入口

| 项目 | 地址 / 位置 |
|---|---|
| 主仓库（已公开） | https://github.com/liuxiangdahai/huideng-calendar-trial |
| 技术试用站 | https://huideng-calendar-trial.pages.dev/calendar-reminders/ |
| 隔离验收站 | https://huideng-calendar-acceptance.pages.dev/calendar-reminders/ |
| 独立真实提醒测试 | https://huideng-calendar-acceptance.pages.dev/calendar-reminders/reminder-check.html |
| 当前部署代码 | 23abc3e39af655278de05233defcd8f92477b41a |
| 文档基线 | 11月5日纹样/UIUX验收更新；开始工作时取最新 main |
| 已核对发布流水线 | https://github.com/liuxiangdahai/huideng-calendar-trial/actions/runs/42003059089 （第二次运行） |

先读以下文档，遇到历史冲突以执行计划顶部现行状态及用户最新指示为准：

1. `docs/calendar-execution-plan.md`：当前安排、目标及未通过的门槛。
2. `docs/calendar-uiux-review.md`：11月5日用户授权的每日日期、订阅状态与纹样已实施；每日日期最后改为与方案共享纸底。最新验收/发布状态看执行计划。
3. `docs/calendar-next-actions.md`：用户和维护者的职责，免下载测试方法。
4. `docs/calendar-user-guide.md`、`docs/calendar-reminder-acceptance.md`：应用能力与证据边界。
5. `docs/calendar-source-update-proposal.md`、`docs/calendar-cost-and-source-audit.md`：资料更新和费用。
6. `docs/calendar-source-licenses.md`、`static/calendar-reminders/assets/README.md`：标志及素材。

## 2. 技术结构与编辑位置

前端为原生 HTML/CSS/JavaScript ES Modules，没有 React、Vue 等应用框架。工程使用 Node.js 24 与 esbuild 构建。可导出单文件离线 HTML，但它是交付产物，不能作为唯一源代码修改，也不能独立完成在线订阅。

```text
网页 / 手机日历
    → 稳定的 Pages HTTPS 地址
    → Pages 网关（Service Binding）
    → Worker
    → D1
```

| 需要修改的内容 | 主文件 |
|---|---|
| 页面结构、每日藏历选项、弹窗 | `static/calendar-reminders/index.html` |
| 页面样式、共享颜色与组件 | `static/calendar-reminders/style.css` |
| 月历、列表、日期详情 | `static/calendar-reminders/calendar-view.mjs`、`calendar-view.css` |
| 应用状态与订阅操作 | `static/calendar-reminders/app.mjs` |
| 图标、分类与日期说明 | `icons.mjs`、`event-presentation.mjs`（同上目录） |
| 快捷方案与手机吸顶切换 | `presets.mjs`、`mobile-tabs.mjs`（同上目录） |
| 添加方式、中文帮助与连接状态 | `calendar-entry.mjs`、`subscription-guide.mjs`、`subscription-guide.css`、`connection-check.mjs` |
| 日期和设置模型、ICS | `core.mjs`、`engine.mjs`、时区模块及固定版本 `vendor/zangli/` |
| 节日来源、目录和稳定记录编号 | `data/calendar/`；更新比对 `tools/calendar/fohui-diff.mjs` |
| Worker / Pages 网关 | `service/calendar/`、`service/gateway/` |
| 产品唯一构建与环境绑定 | `tools/calendar/release-build.mjs`、`build-environment.mjs` |
| 唯一发布流程 | `.github/workflows/calendar-trial.yml` |

表中未重复目录的前端模块均在 `static/calendar-reminders/`。正式输出为 `dist/site/`；环境构建另生成相应 Pages 与 Worker 目录。源代码包应从 Git 跟踪内容打包，排除本机配置、数据库、依赖和临时报告。

## 3. 必须保留的产品行为

- 初次访问全部不选；不加登录、支付、恢复默认或撤销入口。已有浏览器选择、时区、提醒及管理凭证继续保留。
- 三个快捷方案当前为 1 / 2 / 54 项：莲师荟供、两个荟供日、全部修行日。第三项只让两个荟供日提醒，其余仅显示。范围以目录计算，不在新组件中写死项目数。
- “每日藏历日期”默认关闭，可单独订阅或与修行日共用同一地址；每天一条全天事件，不能产生 VALARM，也不占忙碌时间。切换快捷方案保留它，清空选择关闭它，批量提醒不能影响它。
- 每日日期不是手机系统自带的副历标签。月历原有藏历日期不因该选项关闭而消失；开启不使月格活动数每天多加 1。详情显示实际加入的每日条目，列表按 30 天追加。
- 藏历 PRO 负责换算；佛慧法语决定节日原名及明确安排。原历变更先记录，不以其他历书覆盖，不把未确认法会/日月食按去年日期机械外推。
- 使用“重日1 / 重日2”和“闰月”，不将第二个重日改名为“润某日”。节日原名不能为适应版式被改写；月格可简写，详情保留全名。
- “今天”和设备时钟跟随设备；提醒时区保存用户选择，旅行时不能静默更改。全天日期和具体提醒时刻分开。
- 固定订阅地址、匿名管理、v2 设置兼容、稳定 UID、递增 SEQUENCE、撤销和快照机制必须保留。界面改造不重建订阅、不清空数据库、不改变 `.ics` 路径或域名。
- Apple 可直接打开，微信先转 Safari；Google/Outlook 的手动添加路径先复制再打开。保留复制失败、手动添加、文件导入备选；文件导入不是长期订阅。
- 提醒测试使用独立验收订阅，不要求下载文件或报告。不能给整份日历加默认提醒来掩盖兼容问题，否则每日日期也可能通知。
- 复制地址、打开应用、下载、连接检查正常，都不是“手机订阅成功”或“已收到通知”的证据。

## 4. 当前已完成与未完成

23abc3e 已部署试用/验收两站，新增统一纸底的每日日期附加行、连接详情及原创SVG装饰；保留先复制再打开、免下载测试和下一次已确认法会日期提示。143项日期/服务/构建、三种浏览器各60项、完整隔离链路143次请求和提醒专项15次请求通过。最新证据见 `docs/evidence/ornament-ui-20261105/`，0521057记录保留作历史。

以下不能写成已完成：

- 真实手机：只有一次用户报告的 iPhone 原生日历成功通知；双提醒、改期、静默、撤销及各平台矩阵待验收。iPhone 详情未显示提醒字段不单独判失败。Google/Outlook 不保证保留网页逐项提醒。
- 性能：本轮 Worker CPU p95 52.257ms，高于8ms目标；指标返回106次请求采样汇总，客户端记录143次；网关指标不可用。前端本轮交互p95均≤176ms、连续100次设置保留，但冷启动仍有372ms长任务。不能把“CI绿色”写成全部性能或免费额度通过。首次发布healthz 503、第二次完整发布成功，不声称间歇问题已根除。
- 503：本轮未出现，历史间歇原因未确定，不能声称永久解决。
- 佛慧法语自动检测：已定规则，但稳定资料读取及完整差异处理尚未接通，没有启用定时抓取。
- 资料快照截至2027-05-06；滚动未来24个月不代表所有法会和天象都有已确认资料。
- 官网接入：独立导航补丁已准备，未由本仓库发布慧灯官网。详见 `docs/integration/README.md`；不要修改另一份 `site1` 工作区。
- 完整直连网络、5人体验、七天试用、回滚/恢复等仍以执行台账为准。代理网络和模拟手机不顶替实测。

## 5. 协作与发布

建议一轮由一个助手负责代码，另一个只审阅。Claude 可以主改设计和前端，Codex 审阅行为回归与交付；也可反过来，但不要同时写同一工作目录。

1. 开始先检查 Git 状态及远端更新；保留他人未提交内容。使用各自分支/独立检出，在交接中写清分支、基准提交和改动文件。
2. 第一轮集中做“每日藏历融入选择区、信息层次、订阅操作面板”，保留视觉主线及功能。后端性能、自动资料更新另提独立改动，便于查因和回滚。
3. 先给出推荐方向及理由，做可运行的真实页面和同状态手机/电脑截图。设计稿、可用界面和生产发布分别标明，不能用静态假页面替代实际交互。
4. 本地验证、分支提交/PR、按已有发布授权推进。不要为已授权的例行步骤反复确认；涉及新的费用、域名、用户数据或产品行为时先说明具体影响。
5. 当前 **PR只运行检查，不自动生成专属云预览**。合入/推送 `main` 的产品变更会按现有设置启动“检查 → 验收Worker/D1 → 验收Pages → 远端测试/指标 → 试用Worker/Pages → 版本核对”。保持这条链，不另开自动直传生产的通道。
6. 当前指标步骤会记录未达标项，不等于所有性能数值都被自动设置为阻断条件。绿色发布只说明现有技术流程完成，不能作为扩大邀请或完整产品验收通过的理由。
7. GitHub Actions 已有云部署凭证。公开仓库只提供读取，不自动赋予 Claude 推送权限；需要用户在官方界面授权对应仓库。一般前端修改无需把 Cloudflare Token 发给 Claude。不要将 `deployment.local.json`、`.env`、`.dev.vars`、管理链接或私钥粘贴到聊天、提交或上传。
8. 更新 `docs/calendar-execution-plan.md`、本轮验收说明、同源码离线文件及源码包。报告区分：本地通过、线上通过、真实设备通过、未测。

## 6. 本地构建与验证

使用仓库锁定依赖，Node.js 24。首次检出安装依赖：

```sh
npm ci
npm run build:local
npm run dev:calendar
```

`dev:calendar` 默认服务源码。要对正式构建截图和回归，使用仓库测试脚本（会构建并指定 `dist/site`）；手动预览时同样设置 `CALENDAR_STATIC_ROOT=dist/site`。验收服务使用独立内存库，不能以试用用户数据作为自动测试夹具。

```sh
npm run check:calendar
npm run test:browser
npm run test:browser:all
```

先运行与改动有关的检查，再完成发布规定的三引擎回归。首次三引擎运行可能需按 Playwright 提示安装浏览器。截图来自被测构建；日期资料生成后若有差异，核查来源，不用“接受快照”方式掩盖错误。单文件由 `npm run build:standalone` 或产品构建生成；线上保持分文件缓存。

## 7. 交付内容

推荐方案及理由、真实页面截图、源码分支/提交、改动说明、测试结果、尚未通过的指标、上线状态和可回滚版本。每个“通过”给出对应构建及证据位置。用户不必自行复述整段历史，缺少的账号权限或真机结果再具体询问。

工具说明参考：[Claude Code](https://code.claude.com/docs/en/overview)、[Claude Code云端GitHub连接与分支](https://code.claude.com/docs/en/claude-code-on-the-web)。这些是能力说明，不能代替当前会话实际获得的仓库权限。
