# 0521057 添加流程与免下载测试证据

代码版本：0521057b3fe05db7a20c90119a5402fa778b99b5。发布流水线：[41794171062](https://github.com/liuxiangdahai/huideng-calendar-trial/actions/runs/41794171062)。2026-11-05复核试用/验收版本及资料摘要一致。

- `remote-smoke.json`：GitHub网络经隔离Pages完成143请求，包含四类方案、实际提醒核对、30次修改、每日日期及撤销；不创建试用站测试订阅。
- `reminder-probe-remote.json`：独立短期订阅15请求，六项事件、五个提醒；改期、仅显示、取消与停用通过。
- `cloudflare-metrics.json`：汇入95/143请求、0报错，CPU p95 74.896ms。CPU目标未通过，网关样本不可用，不能证明免费额度余量。
- `google-desktop.png`、`google-mobile-width.png`：同一桌面应用选择在不同窗口宽度下的实际顺序，先复制再打开。不是手机Google应用能力证据。截图输入框替换为“订阅地址已遮盖”，订阅逻辑未改变。
- `practice-desktop.png`：法会下一次原历明确日期，以及未来资料待确认。原年法会未外推成每年固定规则。
- `review.json`：正式本地构建，320/390/585/1440px无横向溢出；添加操作高度46px以上，0脚本错误。
- `reminder-probe-live-390.png`、`reminder-probe-live-ui.json`：发布页390px模拟Apple浏览器，真实隔离创建/检查/停用；Apple入口可见，无旧导出入口，有复制中文结果入口。经过开发机代理，不算大陆/海外直连，也不算真实iPhone通知证据。截图订阅地址及管理链接已替换文字。

历史503本轮未出现，根因仍待观察；不声称已根除。真实通知、双提醒、静默、改期与撤销的手机证据继续另记。
