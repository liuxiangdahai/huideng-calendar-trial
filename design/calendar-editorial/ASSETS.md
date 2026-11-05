# 美术素材与使用记录

日期：2026-10-23。用途：藏历页面关键画面提案，当前尚未替换正式页面。

## 雪山背景

使用内置 ImageGen 生成一张通用的喜马拉雅雪山意象，不标注为某座实际山峰，不作为节日或历法资料。参考用户提供的两张图片的深青、金色雪峰及沉静气氛；未复制参考图的界面文字、宗教图像、宜忌或天气内容。

- 原图：`assets/himalaya-master.png`，2172 × 724。
- 电脑压缩图：`assets/himalaya-1600.jpg`，1600 × 533，68410 bytes。
- 手机压缩图：`assets/himalaya-800.jpg`，800 × 267，22813 bytes。
- 衍生图仅等比例缩放并压缩为 JPEG，未改变画面内容；页面文字、印记、图标及边框均由 HTML/SVG/CSS 实现。
- 图片只放在浅幅页头，左侧深色覆盖层保证真实日期文字可读。移动端采用较小图片；单文件为了离线查看内嵌两种尺寸，正式网页整合时按屏幕选择资源。
- 生成设置：不透明背景；新图生成；未传入其他目标图编辑。

完整生成提示词：

```text
Create one exceptionally refined photographic panoramic background asset for a Tibetan Buddhist practice calendar website, inspired by Himalayan dusk and fine Tibetan book covers. A long realistic snow mountain ridge with a few warm amber sunlit peaks, deep mineral teal/navy shadows, soft restrained clouds, natural atmospheric perspective, no huge dramatic overprocessed sun. The panorama should feel contemplative, elegant and quiet, premium editorial photography, carefully composed detail rather than fantasy. Extra wide horizontal composition approximately 3:1: mountain peaks occupy upper middle, lower half has darker tranquil mist, left third is darker with negative space for real webpage typography to be overlaid later. Palette strictly deep teal #163D45, ink-blue, warm muted gold light, ivory snow. No text of any language, no calligraphy, no logo, no frame, no interface, no people, no deity, no buildings, no prayer flags, no watermarks, no neon, no oversaturated orange. This is only a background asset, NOT a screenshot or a website design. It will be cropped into a shallow 170px masthead on desktop and a 90px masthead on mobile.
```

## 提案构建与隔离

执行 `node tools/calendar/design-preview.mjs` 生成上一级目录中的 `藏历日历-视觉提案.html`。该文件使用真实现有日期逻辑和目录，沿用实际操作控件。提案的浏览器存储使用独立命名空间，不读取或覆盖原页面的选择与管理凭证；不配置虚构订阅后台。

`editorial.css` 是本阶段的独立美术候选样式，风格确认后再整理并合并到正式组件样式，避免长期叠加覆盖。

## 2026-10-24：慧灯标志及细线装饰

- `assets/huideng-logo.png`：用户提供的慧灯小组标志，749×797，透明PNG，96429 bytes。原图逐字节复制，未重画、拉伸或改变颜色；显示时使用固定尺寸容器和 `object-fit: contain` 保留比例。外部纸色金边底托由CSS实现，不改动标志本身。
- `assets/cloud-flourish.svg`：本项目绘制的祥云细线装饰，168×64，只用于栏目边缘，暖金单色、不可交互、不会覆盖日历文字。
- `assets/knot-divider.svg`：本项目绘制的菱形结饰分隔线，320×24，放在月历与当天详情之间。不是历法或宗教文字资料。
- 新增 `ritual-bell` / `bell-vajra` 原创24单位SVG图标：分别表示单荟供方案与双荟供方案。双荟供与荟供分类共用图形；通知按钮仍用通用铃铛，避免混淆仪轨法器与通知功能。
- 标志文件与装饰均内嵌候选页，离线可见。雪山素材仍使用上一节生成图，本次未重新生成或修改用户标志。

## 2026-11-05：纹样参考与正式界面整理

前述独立提案是历史记录，当前正式/单文件统一由 `tools/calendar/release-build.mjs` 构建，不再叠加 `editorial.css`。本轮保留原雪山与原标志。

- 用户新提供两张装饰参考：一张带昵图网水印，一张是低分辨率总览。原图保留在仓库外的本地参考包，未上传公开仓库或复制到发布资源目录。
- `static/calendar-reminders/assets/scroll-corner.svg`：72单位画布，项目自行编排的卷草和双线角花，统一古金；网页实际显示22或46px，不进入文字区域。
- `static/calendar-reminders/assets/woven-flourish.svg`：136×36画布，项目自行编排的卷曲线与菱形交织，中间一处深青点缀；用于选择标题旁与日期详情分隔，实际宽92或102px。
- 不直接裁切或描摹用户图片，不去水印，不增加佛像、宜忌、天气、藏文或无来源日期信息。没有新增位图或字体请求。
- 用户指出每日日期青灰底与整体不一致；最终改为与快捷方案共享暖纸底、墨色标题、古金图标。用方形复选框和单条分隔线表达附加内容，不靠不同底色制造层级。
