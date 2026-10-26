import { icon } from './icons.mjs';
import { calendarEnvironment } from './calendar-entry.mjs';

// Guide progress belongs to this browser. It is never evidence of a successful
// subscription or of a notification delivered by a calendar application.
const APPS = ['iphone', 'google', 'other'];
const HELP = {
  apple: 'https://support.apple.com/zh-cn/guide/iphone/iph3d1110d4/ios',
  appleNotifications: 'https://support.apple.com/zh-cn/guide/iphone/iph7c3d96bab/ios',
  appleMac: 'https://support.apple.com/zh-cn/102301',
  appleMacSubscription: 'https://support.apple.com/zh-cn/guide/calendar/icl32362/mac',
  appleMacNotifications: 'https://support.apple.com/zh-cn/guide/calendar/icl1025/mac',
  googleAdd: 'https://support.google.com/calendar/answer/37100?co=GENIE.Platform%3DDesktop&hl=zh-Hans',
  googleNotifications: 'https://support.google.com/calendar/answer/37242?co=GENIE.Platform%3DAndroid&hl=zh-Hans',
  huaweiNotifications: 'https://consumer.huawei.com/cn/support/content/zh-cn16080985/',
  huaweiImport: 'https://consumer.huawei.com/cn/support/content/zh-cn16070813/',
  oneplusCalendar: 'https://oasisstatics.oneplus.cn/content/dam/support/gsppics/user-guide/OnePlus_9RT_User_Manual_CN.pdf#page=37'
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (url, label) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}<span aria-hidden="true"> ↗</span></a>`;
const steps = items => `<ol class="guide-steps">${items.map(([symbol, text], i) => `<li><span class="guide-step-icon" aria-hidden="true">${icon(symbol)}<span>${i + 1}</span></span><div>${text}</div></li>`).join('')}</ol>`;
const location = (text, symbol = 'phone') => `<p class="guide-location">${icon(symbol)}${text}</p>`;

export function normalizeGuideState(raw = {}) {
  // An old brand preference no longer changes instructions or user checks.
  const state = { app: APPS.includes(raw?.app) ? raw.app : '', progress: {}, expanded: {} };
  for (const app of APPS) {
    state.progress[app] = { seen: raw?.progress?.[app]?.seen === true, reminders: raw?.progress?.[app]?.reminders === true };
    state.expanded[app] = raw?.expanded?.[app] === true;
  }
  return state;
}

function preparationText(context) {
  if (context.preparing) return '正在准备订阅，请稍候。';
  if (context.entryReady) return '使用上方按钮继续添加。已经添加过这份日历时，无需重复订阅。';
  if (context.hasSubscription) return '修改过选择时，请先在上方保存修改，再继续添加。';
  return '订阅尚未准备好时，可在上方重试，或使用文件导入。';
}

const addSteps = (app, body) => `<details class="guide-help guide-add-details" data-guide-help="adding-${app}"><summary>查看添加步骤</summary><div class="guide-add-body">${body}</div></details>`;

function openingHelp(device) {
  if (!device.apple) return `<details class="guide-help" data-guide-help="open-failed"><summary>没有打开？</summary><div class="guide-add-body"><p>当前设备可能无法打开 Apple 日历。请复制上方的订阅地址，发送给自己的 iPhone、iPad 或 Mac，再按“查看添加步骤”中的手动方法添加。</p><p>若实际使用的是 Google 日历或其他手机日历，可在上方改选应用，已选的修行日会保留。</p></div></details>`;
  return `<details class="guide-help" data-guide-help="open-failed"><summary>没有打开？</summary><div class="guide-add-body">
    ${device.inAppBrowser ? `<p class="guide-handoff">当前可能在${escape(device.inAppBrowser)}的内置浏览器中，日历跳转可能被拦截。</p>${steps([
      ['sliders', '打开当前页面右上角的菜单。'],
      ['globe', '若有“在浏览器打开”或“在 Safari 中打开”，选择这个入口。'],
      ['calendar-plus', '在浏览器中返回本页的订阅入口，再点按“打开 Apple 日历订阅”。']
    ])}<p>若没有外部浏览器入口，可复制当前网页地址，在 Safari 或系统浏览器中打开。更换浏览器后若没有原来的选择，请使用自己保存的管理链接恢复；也可直接复制订阅地址，在日历中手动添加。</p>` : '<p>若浏览器询问是否打开“日历”，请选择允许。若没有弹出窗口，可在 Safari 或系统浏览器中打开本页后重试。</p>'}
    <p>也可以复制上方的订阅地址，按“查看添加步骤”中的手动方法添加。复制地址本身不会完成订阅。</p>
    <p class="guide-note">若已在系统窗口取消，可再次点按打开按钮；如果已经添加，请先到日历中检查，避免重复添加。</p>
  </div></details>`;
}

function addition(app, context, device) {
  const prepare = preparationText(context);
  if (app === 'iphone') {
    const direct = device.appleMobile || device.mac;
    const directSteps = direct
      ? [['calendar-plus', '点按上方“打开 Apple 日历订阅”。'], ['calendar-check', '在系统打开的日历窗口中确认添加。']]
      : [['copy', '复制上方的订阅地址。'], ['phone', '将地址发送给自己的 iPhone、iPad 或 Mac。']];
    return addSteps(app, `${location(device.mac ? '在电脑上操作 · Mac' : device.appleMobile ? '在手机上操作 · iPhone / iPad' : '当前设备用于准备，下一步转到 Apple 设备', device.mac ? 'calendar' : 'phone')}
      <p>${prepare}</p>${steps(directSteps)}
      <details class="guide-help" data-guide-help="apple-manual-phone"><summary>在 iPhone / iPad 上手动添加</summary>${location('在手机上操作 · iPhone / iPad')}${steps([
        ['calendar', '打开 Apple“日历”应用。'],
        ['calendar', '点按底部的“日历”，进入日历列表。'],
        ['calendar-plus', '在“添加日历”菜单中选择“添加订阅日历”。'],
        ['copy', '粘贴订阅地址。'],
        ['search', '点按“查找”；较早版本可能显示“订阅”。'],
        ['calendar-check', '按屏幕提示确认添加。']
      ])}<p class="guide-links">${link(HELP.apple, 'Apple 中文订阅帮助')}</p></details>
      <details class="guide-help" data-guide-help="apple-manual-mac"><summary>在 Mac 上手动添加</summary>${location('在电脑上操作 · Mac', 'calendar')}${steps([
        ['copy', '复制上方的订阅地址。'],
        ['calendar', '打开 Mac 的“日历”应用。'],
        ['calendar-plus', '在“文件”菜单中选择“新建日历订阅”。'],
        ['copy', '粘贴订阅地址。'],
        ['calendar-plus', '点按“订阅”。'],
        ['calendar-check', '按屏幕提示完成订阅。']
      ])}<p class="guide-note">需要在其他 Apple 设备查看时，可在“位置”选择 iCloud，并在这些设备使用同一 Apple 账户。</p><p class="guide-links">${link(HELP.appleMacSubscription, 'Mac 中文订阅帮助')} ${link(HELP.appleMac, 'Apple 中文多设备帮助')}</p></details>`) + openingHelp(device);
  }
  if (app === 'google') return `${device.mobile ? '<p class="guide-handoff">手机应用无法通过网址添加订阅。请把订阅地址发给自己，下一步转到电脑。</p>' : ''}${addSteps(app, `${location('在电脑上操作 · Google 日历网页', 'calendar')}
    <p>${prepare}</p>${steps([
      ['copy', '复制上方的订阅地址。'],
      ['calendar', '在电脑浏览器中点按“打开 Google 日历添加页面”。'],
      ['copy', '粘贴订阅地址。'],
      ['calendar-check', '点按“添加日历”。']
    ])}<p class="guide-note">若打开后没有出现添加页面，在 ${link('https://calendar.google.com/', 'Google 日历网页')}左侧找到“其他日历”，点按旁边的加号，再选择“通过网址添加”。请确认当前登录的是手机使用的 Google 账号。</p><p class="guide-links">${link(HELP.googleAdd, 'Google 中文订阅帮助')}</p>`)}
    <p class="guide-caution">本网页逐项设置的提醒时间可能不会生效，请在 Google 日历中检查实际提供的通知选项。</p>`;
  return `${location('在手机上操作 · 你实际使用的日历应用')}
    ${!device.mobile ? '<p class="guide-handoff">电脑上可以准备地址或文件，添加和通知设置请转到手机完成。</p>' : ''}
    <p>先确认日历应用支持网址订阅或文件导入，再选择对应方式。不同应用的入口可能不同。</p>
    ${addSteps(app, `<div class="guide-methods">
      <section class="guide-method" aria-labelledby="guide-url-title">
        <h4 id="guide-url-title">${icon('globe')}网址订阅</h4><p class="guide-method-note">日历同步后，可收到后续内容更新。</p>
        ${steps([
          ['calendar', '在应用帮助中确认是否支持“订阅日历”或“网址订阅”。'],
          ['copy', '在本页复制准备好的订阅地址。'],
          ['calendar-plus', '将地址粘贴到手机日历的订阅入口。'],
          ['calendar-check', '按手机显示的提示完成添加。']
        ])}<button type="button" class="secondary" data-guide-jump="subscription">${icon('copy')}${context.hasSubscription ? '查看订阅地址' : '返回订阅入口'}</button>
      </section>
      <section class="guide-method" aria-labelledby="guide-file-title">
        <h4 id="guide-file-title">${icon('download')}文件导入</h4><p class="guide-method-note">适合支持导入日历文件的应用。</p>
        ${steps([
          ['calendar', '在日历应用中确认有日历文件导入功能。'],
          ['download', '在本页“使用文件导入”中下载日历文件。'],
          ['phone', '在手机日历中选择下载的 .ics 文件。'],
          ['calendar-check', '按手机显示的提示确认导入。']
        ])}<button type="button" class="secondary" data-guide-jump="file">${icon('download')}前往下载文件</button>
      </section>
    </div>`)}
    <p class="guide-caution">网址订阅是否可用取决于日历应用与系统版本。文件导入不会持续更新；再次导入前，请先删除旧的专用日历，避免重复。</p>
    <h4 class="guide-brand-heading">按手机查找帮助</h4>
    <details class="guide-help" data-guide-help="huawei-import"><summary>华为：文件导入</summary>
      <p>适用于官方帮助列出的 HarmonyOS 5.0、5.1、6.0、6.1 机型。其他版本请先核对手机实际入口。</p>
      ${steps([
        ['calendar', '打开华为“日历”应用。'],
        ['calendar', '点按日历列表图标。'],
        ['plus', '点按“添加”。'],
        ['calendar-plus', '选择“导入日程”。'],
        ['calendar-plus', '选择“从文件导入”。'],
        ['search', '找到本页下载的 .ics 文件。'],
        ['calendar-check', '点按“完成”。'],
        ['search', '核对即将导入的日程预览。'],
        ['calendar', '选择接收日程的日历账户。'],
        ['calendar-check', '点按“接收”。']
      ])}<p class="guide-links">${link(HELP.huaweiImport, '华为中文导入帮助及适用机型')}</p>
    </details>
    <details class="guide-help" data-guide-help="oppo-subscribe"><summary>OPPO／一加：检查网址订阅</summary>
      <p>以下入口已在一加 9RT 的 ColorOS 12 官方手册中核实。其他 OPPO／一加机型及系统版本可能不同，请先检查是否有相应功能。</p>
      ${steps([
        ['calendar', '打开手机“日历”应用。'],
        ['person', '进入“我的”。'],
        ['calendar-plus', '选择“添加日历”。'],
        ['calendar-plus', '选择“订阅日历”。'],
        ['copy', '粘贴本页的订阅地址。'],
        ['calendar', '按提示填写日历名称等信息。'],
        ['calendar-check', '按手机提示完成订阅。']
      ])}<p class="guide-note">这是网址订阅步骤。若找不到对应入口，请查看当前应用帮助，确认是否支持订阅或文件导入。</p><p class="guide-links">${link(HELP.oneplusCalendar, '一加 9RT 中文手册 · 第 37 页')}</p>
    </details>
    <details class="guide-help" data-guide-help="xiaomi-check"><summary>小米／REDMI：检查添加能力</summary>
      <p>目前未确认适用于各版本的统一文件导入入口，请以你实际使用的日历应用为准。</p>
      ${steps([
        ['calendar', '打开手机上准备接收日程的日历应用。'],
        ['search', '在应用的帮助或设置中查找“订阅日历”或“导入日历文件”。'],
        ['calendar-plus', '若支持其中一种方式，按上方相应步骤添加。']
      ])}<p class="guide-note">若两种方式都没有，请查看应用帮助或使用支持网址订阅、日历文件导入的其他日历应用。手机品牌相同，也可能使用不同的日历应用。</p>
    </details>`;
}

function notificationSteps(app, device) {
  if (app === 'iphone' && device.mac) return `${location('在电脑上操作 · Mac', 'calendar')}
    <h4>保留这份日历的提醒</h4>${steps([
      ['calendar', '打开 Mac 的“日历”应用。'],
      ['search', '在左侧日历列表中选中“慧灯藏历”。'],
      ['sliders', '在“编辑”菜单中选择“显示简介”。'],
      ['bell', '若“忽略提醒”已勾选，取消勾选。'],
      ['bell', '若“移除”区域勾选了“提醒”，取消勾选。'],
      ['calendar-check', '点按“好”保存。']
    ])}<h4>检查 Mac 系统通知</h4>${steps([
      ['sliders', '打开 Mac 的“系统设置”。'],
      ['bell', '在边栏中选择“通知”。'],
      ['calendar', '在应用列表中选择“日历”。'],
      ['bell', '打开“允许通知”。']
    ])}<p class="guide-note">若也需要在 iPhone 或 iPad 收到提醒，请在那台设备上分别检查日历提醒和系统通知。</p><p class="guide-links">${link(HELP.appleMacSubscription, 'Mac 中文订阅设置帮助')} ${link(HELP.appleMacNotifications, 'Mac 中文提醒帮助')}</p>`;
  const handoff = !device.mobile ? '<p class="guide-handoff">接下来请拿起手机，在手机中检查以下设置。</p>' : '';
  if (app === 'iphone') return `${handoff}${location('在手机上操作 · iPhone / iPad')}
    <h4>打开这份日历的提醒</h4>${steps([
      ['calendar', '打开 Apple“日历”应用。'],
      ['calendar', '点按底部的“日历”。'],
      ['search', '找到“慧灯藏历”；文件导入时，找到接收日程的日历。'],
      ['search', '点按这份日历旁的信息按钮（圆圈中的 i）。'],
      ['bell', '打开“日程提醒”。'],
      ['calendar-check', '点按“完成”。']
    ])}<h4>检查系统通知</h4>${steps([
      ['sliders', '打开手机“设置”。'],
      ['bell', '进入“通知”。'],
      ['calendar', '选择“日历”。'],
      ['bell', '打开“允许通知”。']
    ])}<p class="guide-links">${link(HELP.apple, 'Apple 中文日历提醒帮助')} ${link(HELP.appleNotifications, 'Apple 中文系统通知帮助')}</p>`;
  if (app === 'google') return `${handoff}${location('在手机上操作 · Google 日历')}
    <p>请先确认使用的是添加订阅时的 Google 账号，并已看到日程。</p>${steps([
      ['calendar', '打开 Google 日历应用。'],
      ['sliders', '打开左上角菜单。'],
      ['sliders', '进入“设置”。'],
      ['calendar', '选择“慧灯藏历”对应的日历。'],
      ['bell', '若有“通知”选项，按需设置提醒。'],
      ['search', '在手机系统设置中搜索 Google 日历。'],
      ['bell', '检查这个应用的通知权限是否已开启。']
    ])}<p class="guide-caution">若该订阅没有通知选项，无法在本页强制开启。网页设置的逐项提醒也可能不生效，请以手机日历实际显示为准。</p><p class="guide-links">${link(HELP.googleNotifications, 'Google 中文通知帮助（Android）')}</p>`;
  const huawei = `<details class="guide-help" data-guide-help="huawei-notifications"><summary>华为 HarmonyOS 6.0 通知入口</summary><p>以下名称来自对应版本的官方说明；其他版本请使用上方通用步骤。</p>${steps([
    ['sliders', '打开手机“设置”。'], ['bell', '进入“通知和状态栏”。'], ['calendar', '选择你使用的日历应用。'], ['bell', '打开“允许通知”。']
  ])}<p class="guide-links">${link(HELP.huaweiNotifications, '华为中文通知帮助')}</p></details>`;
  return `${handoff}${location('在手机上操作 · 当前日历应用')}${steps([
    ['calendar', '在手机日历中打开一项已添加的日程。'],
    ['bell', '检查日程中显示的提醒时间。'],
    ['search', '在手机系统设置中搜索日历应用的名称。'],
    ['bell', '在该应用的通知设置中允许通知。']
  ])}<p class="guide-note">若日程没有显示提醒时间，请在日历应用中补充设置。各品牌的菜单名称可能因版本不同而变化。</p>${huawei}`;
}

function progressText(progress, hasReminders) {
  if (!progress.seen) return '请先到日历应用中查看日程，再自行勾选确认。';
  if (hasReminders && !progress.reminders) return '已记录你看到日程；请继续检查日历提醒。';
  return hasReminders ? '已记录你的检查结果。实际提醒请以设备收到的通知为准。' : '已记录你看到日程。当前选择仅显示，无需开启提醒。';
}

export function createSubscriptionGuide(root, { notificationRoot = root, initialState, onStateChange = () => {}, onTestReminder = () => {} } = {}) {
  if (!root) throw new TypeError('缺少订阅引导容器');
  let state = normalizeGuideState(initialState);
  let context = { app: state.app, hasReminders: true, hasSubscription: false, preparing: false, entryReady: false };
  let renderedKey = '';
  let testStatus = '';
  let testBusy = false;
  const openHelp = new Set();
  const device = calendarEnvironment();
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const notify = () => onStateChange(snapshot());

  function refreshProgress() {
    const text = notificationRoot.querySelector('[data-guide-status]');
    if (text && state.app) text.textContent = progressText(state.progress[state.app], context.hasReminders);
  }

  function render() {
    const key = JSON.stringify(context);
    if (key === renderedKey) return;
    renderedKey = key;
    const focused = root.ownerDocument.activeElement;
    const focusId = (root.contains(focused) || notificationRoot.contains(focused)) ? focused?.id : '';
    const focusHelp = focused?.tagName === 'SUMMARY' ? focused.parentElement?.dataset.guideHelp : '';
    const focusJump = focused?.dataset?.guideJump;
    const focusNotifications = focused?.tagName === 'SUMMARY' && focused.parentElement?.hasAttribute('data-guide-expand');
    // A network response may refresh the panel between focus/activation and the
    // queued details toggle. Preserve the actual open state and keyboard focus.
    const previousNotifications = notificationRoot.querySelector('[data-guide-expand]');
    if (state.app && previousNotifications && previousNotifications.dataset.app === state.app) state.expanded[state.app] = previousNotifications.open;
    // Read current DOM as well as toggle events: preparing may finish while the
    // user is opening a help section, before its queued toggle has fired.
    for (const container of new Set([root, notificationRoot])) {
      for (const help of container.querySelectorAll('[data-guide-help]')) {
        if (help.open) openHelp.add(help.dataset.guideHelp); else openHelp.delete(help.dataset.guideHelp);
      }
    }
    if (!state.app) {
      root.innerHTML = '<p class="guide-select-note">先选择你使用的日历应用，查看对应的中文添加步骤。</p>';
      if (notificationRoot !== root) notificationRoot.innerHTML = '';
      return;
    }
    const app = state.app;
    const progress = state.progress[app];
    const onMac = app === 'iphone' && device.mac;
    const addHtml = `<section class="guide-add" aria-label="中文添加帮助">${addition(app, context, device)}</section>`;
    const notificationHtml = `<section class="guide-check" aria-labelledby="guide-check-title"><h3 id="guide-check-title"><span class="guide-stage-number">3</span>${context.hasReminders ? '检查日历提醒' : '确认日程显示'}</h3>
      ${location(onMac ? '在电脑上操作 · Mac · 添加之后' : '在手机上操作 · 添加之后', onMac ? 'calendar' : 'phone')}
      <label class="guide-confirm"><input id="guide-seen" data-guide-confirm="seen" type="checkbox"${progress.seen ? ' checked' : ''}><span>我已看到日程<small>已在自己的日历应用中确认日期与内容。</small></span></label>
      ${context.hasReminders ? `<details class="guide-notifications" data-guide-expand${state.expanded[app] ? ' open' : ''}><summary>${icon('bell')}<span>查看开启步骤</span>${icon('chevron')}</summary><div class="guide-notification-body">${notificationSteps(app, device)}
        <details class="guide-help" data-guide-help="notification-missing"><summary>找不到这个入口</summary><p>${onMac ? '在 Mac“系统设置”的搜索框中输入“通知”，找到“日历”的通知设置。日历列表未显示时，可在日历的“显示”菜单中选择“显示日历列表”。' : '在手机“设置”的搜索框中输入日历应用名称，打开这个应用的设置，查找通知权限。'}若日历内没有对应选项，请查看该应用的帮助；不同版本的名称可能不同。</p><p>如果日程尚未出现，请先检查是否勾选显示这份日历，并等待日历应用同步。</p></details>
      </div></details>
      <label class="guide-confirm"><input id="guide-reminders" data-guide-confirm="reminders" type="checkbox"${progress.reminders ? ' checked' : ''}><span>我已检查提醒<small>已检查日历提醒和${onMac ? 'Mac' : '手机'}系统通知权限。</small></span></label>
      <details class="guide-help guide-test" data-guide-help="test-reminder"><summary>可选：测试一次提醒</summary><p>下载后将测试日程导入要使用的${onMac ? 'Mac' : '手机'}日历，提醒时间为生成后约十分钟。文件导入的测试结果不代表订阅日历也会采用同样的提醒。</p><p>${onMac ? '请将文件导入 Mac 的日历；如果耗时超过十分钟，请重新生成。' : device.mobile ? '请立即导入；如果手机不支持导入文件，可在该日历中手动建立十分钟后的测试日程。' : '请把文件传到手机并立即导入；如果耗时超过十分钟，请重新生成。'}</p><button id="test-reminder" class="secondary" type="button">${icon('bell')}下载十分钟提醒测试</button><p id="test-status" class="status-note" role="status">${escape(testStatus)}</p></details>` : '<p class="guide-note">你选择的日程均为“仅显示”，已跳过通知设置。若日历应用自带默认提醒，请关闭这份日历的默认通知。</p>'}
      <p class="guide-progress" data-guide-status role="status">${progressText(progress, context.hasReminders)}</p>
    </section>`;
    if (notificationRoot === root) root.innerHTML = addHtml + notificationHtml;
    else { root.innerHTML = addHtml; notificationRoot.innerHTML = notificationHtml; }
    for (const container of new Set([root, notificationRoot])) {
      for (const help of container.querySelectorAll('[data-guide-help]')) help.open = openHelp.has(help.dataset.guideHelp);
    }
    const testButton = notificationRoot.querySelector('#test-reminder');
    const notifications = notificationRoot.querySelector('[data-guide-expand]');
    if (notifications) notifications.dataset.app = state.app;
    if (testButton) testButton.disabled = testBusy;
    if (focusId) root.ownerDocument.getElementById(focusId)?.focus({ preventScroll: true });
    else if (focusHelp) root.ownerDocument.querySelector(`[data-guide-help="${CSS.escape(focusHelp)}"] > summary`)?.focus({ preventScroll: true });
    else if (focusJump) root.querySelector(`[data-guide-jump="${CSS.escape(focusJump)}"]`)?.focus({ preventScroll: true });
    else if (focusNotifications) notificationRoot.querySelector('[data-guide-expand] > summary')?.focus({preventScroll: true});
  }

  function onChange(event) {
    if (!state.app) return;
    const key = event.target.dataset.guideConfirm;
    if (key === 'seen' || key === 'reminders') {
      state.progress[state.app][key] = event.target.checked;
      notify(); refreshProgress();
    }
  }

  function onToggle(event) {
    if (event.target.matches?.('[data-guide-help]') && event.target.isConnected) {
      const key = event.target.dataset.guideHelp;
      if (event.target.open) openHelp.add(key); else openHelp.delete(key);
    }
    if (state.app && event.target.matches?.('[data-guide-expand]') && state.expanded[state.app] !== event.target.open) {
      state.expanded[state.app] = event.target.open;
      notify();
    }
  }

  async function onClick(event) {
    const jump = event.target.closest('[data-guide-jump]')?.dataset.guideJump;
    if (jump) {
      const document = root.ownerDocument;
      let target;
      if (jump === 'file') {
        const panel = document.querySelector('.download-fallback');
        if (panel) { panel.open = true; target = panel.querySelector('#downloads button:not([disabled])') || panel.querySelector('summary'); }
      } else target = document.getElementById(context.hasSubscription ? 'feed-url' : 'create-subscription');
      target?.scrollIntoView({ block: 'center', behavior: 'auto' });
      target?.focus({ preventScroll: true });
      return;
    }
    if (!event.target.closest('#test-reminder') || !context.hasReminders || testBusy) return;
    const button = notificationRoot.querySelector('#test-reminder');
    testBusy = true;
    if (button) button.disabled = true;
    try { await onTestReminder(); }
    catch { setTestStatus('未能生成测试文件，请重试。'); }
    finally { testBusy = false; const current = notificationRoot.querySelector('#test-reminder'); if (current) current.disabled = false; }
  }

  function setTestStatus(text) {
    testStatus = String(text || '');
    const node = notificationRoot.querySelector('#test-status');
    if (node) node.textContent = testStatus;
  }

  const containers = [...new Set([root, notificationRoot])];
  for (const container of containers) {
    container.addEventListener('change', onChange);
    container.addEventListener('toggle', onToggle, true);
    container.addEventListener('click', onClick);
  }
  render();
  return {
    update(next = {}) {
      if (Object.hasOwn(next, 'app')) {
        const app = APPS.includes(next.app) ? next.app : '';
        if (state.app !== app) { state.app = app; notify(); }
        context.app = app;
      }
      if (Object.hasOwn(next, 'hasReminders')) context.hasReminders = Boolean(next.hasReminders);
      if (Object.hasOwn(next, 'hasSubscription')) context.hasSubscription = Boolean(next.hasSubscription);
      if (Object.hasOwn(next, 'preparing')) context.preparing = Boolean(next.preparing);
      if (Object.hasOwn(next, 'entryReady')) context.entryReady = Boolean(next.entryReady);
      render();
    },
    getState: snapshot,
    setTestStatus,
    destroy() {
      for (const container of containers) {
        container.removeEventListener('change', onChange);
        container.removeEventListener('toggle', onToggle, true);
        container.removeEventListener('click', onClick);
      }
    }
  };
}
