# 时区地区名称来源

`timezone-data.mjs` 为本项目打包的中文显示资料，不在用户打开网页时访问外部服务。

- 地区和代表城市：IANA tzdb **2026e** 的 [zone.tab](https://github.com/eggert/tz/blob/2026e/zone.tab)，共 418 个具名地区；另外提供 UTC。使用逐国家的 zone.tab 保留同样规则下的各国城市名称，便于用户选择。
- 兼容旧名：[IANA backward](https://github.com/eggert/tz/blob/2026e/backward)，并使用 [Unicode CLDR release-48 的 BCP 47 timezone.xml](https://github.com/unicode-org/cldr/blob/release-48/common/bcp47/timezone.xml) 将城市旧名对应到同一地点的新名。zone.tab 内仍存在的独立地点不合并。
- 中文城市：Unicode CLDR JSON **48.0.0** [timeZoneNames.json](https://github.com/unicode-org/cldr-json/blob/48.0.0/cldr-json/cldr-dates-full/main/zh/timeZoneNames.json) 的 exemplarCity。
- 中文国家／地区：同版本 [territories.json](https://github.com/unicode-org/cldr-json/blob/48.0.0/cldr-json/cldr-localenames-full/main/zh/territories.json)。北京检索别名及 UTC 显示文字由项目补充。

生成方式：读取 zone.tab 的国家代码和时区标识，连接 CLDR 地区名称与城市名称；新旧城市标识通过 BCP 47 别名映射补全；只对已弃用的别名归一化。

## 2026 年时区规则兼容修正

本机 Node 的 Intl 规则版本为 2026a，尚未包含 2026b 至 2026e 的最新变更。`timezone-rules.mjs` 因而为以下六地打包了有明确依据的固定偏移修正。UTC 边界逐一根据 2026e [northamerica](https://github.com/eggert/tz/blob/2026e/northamerica) 和 [africa](https://github.com/eggert/tz/blob/2026e/africa) 的最终 Zone 转换记录计算；加拿大的边界采用 IANA 为兼容 CLDR 所记录的最终转换时刻，转换本身不再拨动时钟。

| 时区 | 修正起点（UTC，含此刻） | 之后的偏移 |
| --- | --- | --- |
| America/Vancouver | 2026-11-01 09:00:00 | UTC−07:00 |
| America/Edmonton | 2026-11-01 08:00:00 | UTC−06:00 |
| America/Inuvik | 2026-11-01 08:00:00 | UTC−06:00 |
| America/Winnipeg | 2026-11-01 07:00:00 | UTC−05:00 |
| Africa/Casablanca | 2026-09-20 01:00:00 | UTC+00:00 |
| Africa/El_Aaiun | 2026-09-20 01:00:00 | UTC+00:00 |

修正供偏移标签、公历日期、提醒时间转换和后台滚动范围共用；相应旧名也适用。转换之前和其他地区仍使用运行环境 `Intl`，**并未完整内置一份全球 tzdb**。这一兼容层覆盖已核实的 2026b—2026e 变更，不能预言将来的法律变动。部署和资料维护时需检查 [IANA 最新发布](https://www.iana.org/time-zones)，同步升级运行环境、修正文件和边界测试；后续版本如再次调整这些地点，必须更新或移除旧修正。

IANA 上述文件为 public domain。Unicode 数据使用 Unicode License V3，全文保留于 [UNICODE-LICENSE.txt](./UNICODE-LICENSE.txt)。
