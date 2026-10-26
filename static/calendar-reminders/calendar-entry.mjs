// Device hints recommend an application; they never prove it is installed or
// that an external subscription succeeded. Keep user choice authoritative.
export function calendarEnvironment(nav = globalThis.navigator) {
  const ua = nav?.userAgent || '';
  const appleMobile = /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh|MacIntel/i.test(`${ua} ${nav?.platform || ''}`) && nav?.maxTouchPoints > 1);
  const mac = !appleMobile && /Macintosh|MacIntel/i.test(`${ua} ${nav?.platform || ''}`);
  const mobile = appleMobile || /Android|Mobile/i.test(ua);
  const inAppBrowser = /MicroMessenger/i.test(ua) ? '微信' : /DingTalk/i.test(ua) ? '钉钉' : '';
  return { appleMobile, mac, mobile, inAppBrowser, apple: appleMobile || mac,
    recommendedApp: appleMobile || mac ? 'iphone' : '' };
}

export function appleSubscriptionUrl(feedUrl) {
  try {
    const url = new URL(feedUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return '';
    // Do not replace URL.protocol across special/non-special URL schemes: some
    // browsers keep it unchanged. The validated HTTPS source is the only input.
    return url.href.replace(/^https:/, 'webcal:');
  } catch { return ''; }
}

// Linked by Google's own "通过网址添加日历" help. No external feed, OAuth token,
// or management capability is passed to Google through the navigation URL.
export const GOOGLE_ADD_URL = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl';
