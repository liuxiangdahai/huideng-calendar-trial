# 慧灯官网导航接入

更新：2026-11-02。状态：**补丁已准备并完成隔离校验，尚未修改或发布官网。**

## 本次改动

只给官网现有主导航增加“藏历订阅”，打开[慧灯藏历订阅页面](https://huideng-calendar-trial.pages.dev/calendar-reminders/)。原有“藏历”仍打开藏历 PRO。

补丁：[official-calendar-navigation.patch](official-calendar-navigation.patch)

基线为官网仓库 `huidengvan/site1` 的 `master` 提交 [a1f0039285b120716e4c8f3e1ce0e94fc9541530](https://github.com/huidengvan/site1/commit/a1f0039285b120716e4c8f3e1ce0e94fc9541530)，于 2026-11-02 读取。只修改该提交的 [config.toml](https://github.com/huidengvan/site1/blob/a1f0039285b120716e4c8f3e1ce0e94fc9541530/config.toml)，新增 7 行、删除 0 行。

```toml
[[menu.main]]
  identifier = "zangli-subscription"
  name = "藏历订阅"
  title = "藏历日期与修行日日历订阅"
  url = "https://huideng-calendar-trial.pages.dev/calendar-reminders/"
  weight = 5.3
```

将这一段放在现有 `identifier = "zangli"` 菜单段后面。不要替换、重命名或删除该原有段。

## 提交方式

推荐由官网维护者在最新主分支上创建独立分支，仅加入上述配置，提交待审核的 PR。已有本机 `site1` 工作区含其他未发布改动，本次没有触碰它；不能用它的整份配置覆盖官网。

若使用补丁，在另一份干净的官网检出中执行（补丁路径改成实际保存位置）：

```powershell
git switch -c feat/calendar-subscription-nav
git apply --check "补丁文件的完整路径"
git apply "补丁文件的完整路径"
git diff -- config.toml
```

先检查再应用。如果上游已经调整同一段配置导致检查失败，重新核对最新菜单后只补入新段，不强制应用，不整份覆盖。不要将本日历仓库的 GitHub 发布流程复制到官网。

## 发布前验收

| 检查 | 本轮证据 | 发布门槛 |
|---|---|---|
| 上游原件一致性 | 原配置 Git blob `73d77cc2883e71dacc5e39bb31fe8e02d6c88250` 已核对 | 发布前再次检查最新分支差异 |
| 最小补丁 | 隔离目录 `git apply --check` 和应用通过；TOML 解析后仅多出一个菜单项，其他设置完全相同 | PR 只改官网配置 |
| 保留原藏历 | 原 `zangli` 的名称、标题、URL、权重全部保留 | 页面仍能打开藏历 PRO |
| 同标签页及样式 | 上游主菜单及侧栏模板共用菜单数据，链接没有 `target`；补丁未改模板或样式 | 官网预览中电脑与手机实际点击核验 |
| 日历返回官网 | 正式构建统一将页头品牌与页尾链接输出为 `https://huidengvan.com/`，没有新标签页设置 | 正式构建浏览器中检查返回入口 |
| Hugo 渲染 | 本机现有 Hugo 0.87.0 无法启动，报 Windows 系统 DLL 重定位错误；未据此宣称构建通过 | 由官网现有构建环境生成预览并检查菜单 |
| 新功能与上线门槛 | 每日日期、性能、手机更新及通知另见项目验收报告 | 既定关键门槛通过后再合并发布官网入口 |

基线中的有效 `.github/workflows/main.yml` 使用 Hugo 0.87.0 发布至 GitHub Pages。本补丁不变更该流程。仓库内另有以 `_yml` 结尾的旧部署文件，不能仅凭这些文件存在便认为官网在运行 Azure 发布。

## 后续维护

- 官网只保存稳定的日历页面链接，官网不需要安装本日历的前端依赖，也不承接个人订阅接口。
- 日历的 HTML、样式、脚本、日期资料、网关和订阅服务继续由 `huideng-calendar-trial` 的既有流水线发布。
- 每日藏历与修行日仍使用同一条个人订阅地址。官网导航指向公共页面，不能放入任何人的个人订阅链接或管理链接。
- 不使用 iframe，不复制离线 HTML，不调整官网 DNS。原有 Pages 网址和订阅路径保持稳定。
- 若暂停官网入口，只撤回新增的导航段；不能删除已经承载个人订阅的 Pages 服务。是否扩大邀请以实际验收证据为准。

验证记录：[official-calendar-navigation-evidence.json](official-calendar-navigation-evidence.json)。
