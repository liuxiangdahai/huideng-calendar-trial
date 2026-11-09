# 慧灯藏历：接手手册（一页）

给接手维护的师兄。这里只写最常做的四件事，细节见每节末尾的文档。动手前先看`docs/calendar-execution-plan.md`顶部的“现行状态”。

## 1. 账号和钥匙在哪

| 东西 | 位置 | 谁有权限 |
|---|---|---|
| 代码 | GitHub 仓库`liuxiangdahai/huideng-calendar-trial`（公开） | 仓库所有者 |
| 网站与数据库 | Cloudflare 账户：Pages 项目`huideng-calendar-trial`/`-acceptance`，D1 数据库同名两个 | Cloudflare 账户所有者 |
| 自动发布令牌 | GitHub 仓库 Settings → Secrets：`CLOUDFLARE_API_TOKEN`、`CALENDAR_DEPLOY_CONFIG`；变量`CLOUDFLARE_ACCOUNT_ID` | 仓库所有者 |

数据库里每份订阅的订阅地址都等于“钥匙”：拿到地址就能读到对方的日历。**导出或备份数据库时，文件绝不能提交进公开仓库，也不能不加密地放到任何公开位置。**

## 2. 更新佛慧法语的法会日期（每年一次，最迟在资料到期前）

- 资料到期日看`data/calendar/fohui-dates.json`的`end`（当前到 2027-05-06）。过期后，荟供日等按规则推算的日子照常出现，但**法会起止日会从师兄的手机日历里消失**。
- 佛慧法语不允许程序自动抓取，所以由人在浏览器里打开新月份页面，另存为 HTML，再运行：
  `node tools/calendar/fohui-diff.mjs <保存页面的文件夹> --retrieved-on 保存当天日期(YYYY-MM-DD)`（先看差异），确认无误后加`--apply`合并。
- 合并后照第 3 节发布。
- 细节：`docs/calendar-source-update-proposal.md`。

## 3. 发布

1. 新建分支，改完后在本机运行：`npm run build:local`、`npm test`、`npm run test:browser`。
2. 推送分支并开 Pull Request，等自动检查通过。
3. 合并到`main`即自动发布：先发到验收站并自动检查，通过后才发到正式网址。
4. 打开`https://huideng-calendar-trial.pages.dev/calendar-reminders/`确认页面正常。
- 细节：`docs/calendar-cloudflare-setup.md`“唯一发布链路”。

## 4. 出问题时回滚

- 网页出错：在 GitHub 上对出问题的合并点“Revert”，再合并这个撤销，自动发布会把上一版发回去。
- 数据库误改：Cloudflare D1 自带按时间点恢复（保留天数以 Cloudflare 当前说明为准）；操作前先导出一份加密备份。
- 细节：`docs/calendar-cloudflare-setup.md`“回滚与恢复”。

## 设计约定（改样式前读）

- 颜色只用`static/calendar-reminders/style.css`顶部`:root`里的变量：胭脂红=操作/选中/提醒，青金=结构/标题/链接，古金=细线与纹饰（不做正文颜色），中性色是几乎无彩度的暖灰。
- 字号只用`--fs-*`阶梯；手机自动放大一级，有意义的文字不小于 13px。
- 新文字先想老年师兄能否一眼看懂：一句话说清下一步，少用“订阅”“同步”等术语。
