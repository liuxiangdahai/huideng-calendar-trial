# 正式页面美术资产

雪山：ImageGen 原创喜马拉雅意象，桌面 1600×533、手机 800×267。来源及生成提示词见仓库 design/calendar-editorial/ASSETS.md。

慧灯标志：用户提供原图保持在 design/calendar-editorial/assets/huideng-logo.png；发布版为 144×153 透明 PNG，只做等比工程缩放，无重绘、拉伸或改色。原图 96429 bytes，发布版 10161 bytes。

2026-11-08（经页·香布设计）：撤下 `scroll-corner.svg`、`woven-flourish.svg`、`cloud-flourish.svg`、`knot-divider.svg` 四个孤立装饰文件。现行藏式元素全部由代码绘制，不再有独立图片：

- 香布褶带：`style.css` 中 `--shambu` 渐变与遮罩，用于雪山横幅下缘与弹窗顶部。
- 分类图标：`icons.mjs` 中按八吉祥重新绘制的 24 单位线稿（莲花、法轮、宝伞、胜利幢、日月、宝瓶、铃杵、吉祥结），同一网格与线宽。

用户提供的纹样总览仅存于本机“慧灯藏历-设计参考资料”，未打包进本站或公开仓库。其中一张有素材站水印，另一张来源未明；不裁切、去水印或直接描摹。现行图形只取藏式建筑与法器的通用形制（香布、八吉祥），不复制参考图中的具体作品。
