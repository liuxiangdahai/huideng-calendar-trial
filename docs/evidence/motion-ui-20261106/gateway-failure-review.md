# 重复订阅取数 503：只读诊断

核对日期：2026-11-08。此记录只说明已取得的证据，不代表故障修复或上线验收通过。

## 本次失败

- [Actions 42440672275](https://github.com/liuxiangdahai/huideng-calendar-trial/actions/runs/42440672275)，提交 `2c590be5afeb31ba33a130c221f68f888c0989e5`。这是发布验证增加有界等待后的运行。
- 验收 Pages 的版本、资料和环境检查通过；guru、tsok、practice、dual 四个阶段通过。
- `modify-read-30` 中一次 GET 日历在 `2026-11-08T03:04:22Z` 后返回 503，客户端记录用时约 689.8ms；安全错误分类是 `gateway_unavailable`。前一次 PATCH 和随后清理 DELETE 均为 200。失败发生在日历取数，不是等待发布版本的步骤。
- 原始脱敏报告：`remote-smoke-after-wait.json`（81 次客户端请求）和 `cloudflare-metrics-after-wait.json`。它们取自该次工作流的 `release-evidence`，未重写失败值。

## 能确认和不能确认的原因

`service/gateway/gateway.mjs` 的版本比较仅用于 `/healthz`；日历 GET 不执行这项比较。因此这次日历 503 **不是前后端版本等待错误**。

`gateway_unavailable` 是网关 catch 分支的统一中文文案。绑定调用抛错、异常跳转、响应类型不符合约定等，都可能进入该分支；现有报告没有保留阶段分类，无法进一步定责。

后台普通异常由 `service/calendar/service.mjs` 捕获时返回另一条中文文案，冒烟脚本会分类成 `service_unavailable`；并发发布保护失败则是 `publication_conflict`。本次不是这两种分类。因此不能将它写成已证实的 D1 SQL 错误或并发版本冲突；后台运行时在应用 catch 之外被中止的情况仍不能排除。

本次 Cloudflare 汇总只返回 37 次请求，均为 `success`、错误数 0，CPU p95 为 **49.41ms**、p99 为 **77.784ms**；客户端同时段记录为 81 次。查询紧接冒烟结束，且指标使用自适应数据集，不能假定已覆盖失败请求。Pages 指标仍不可用。

所以这份报告 **不能证明 CPU 超限，也不能排除 CPU 超限或绑定调用异常**。49.41ms 本身未达到项目的 8ms CPU 目标；它是时间窗口汇总，不是失败请求的逐请求 CPU。

Cloudflare 官方说明：免费 HTTP CPU 限制为 10ms，运行环境允许偶发超出，但持续超出可能终止执行；确认 CPU 限制应有 `exceededCpu` 等运行结果证据。已有成功高耗时样本不等于免费方案可稳定承载，也不能仅凭高耗时将这次 503 定性为超限。[Cloudflare 限制说明](https://developers.cloudflare.com/workers/platform/limits/)

## 下一步的最小诊断改动

1. 在网关的失败分支保留安全的固定阶段枚举，例如 `binding_fetch`、`unexpected_response_type`、`unexpected_redirect`、`health_mismatch`。不输出请求网址、查询字符串、授权头、设置、响应正文或原始异常文字。
2. 冒烟报告记录上述白名单错误代码，并保留首次失败；不要先加泛化重试把错误隐藏成通过。
3. 仅在隔离验收环境重复原有场景，同时取得对应时间段的 Worker 运行结果和网关证据。补采已结束窗口的指标，明确取样完整性；可区分平台限制时再针对性优化。
4. 如确认 CPU 问题，先分析首次生成中逐条时区换算、内容摘要和 ICS 序列化的成本；继续保持稳定 UID、递增版本、取消记录和正确时区。没有测量前不承诺某项缓存或代码重写可以解决。

本次审计没有修改代码、没有部署、没有新增远端写入测试。下载的两个报告已检查，不含个人订阅地址、管理凭证、授权头或用户设置；Cloudflare 预检原文件没有复制进入公开证据目录。
