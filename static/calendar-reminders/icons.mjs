// Original 24-unit outlines on one grid and stroke. Practice categories draw on
// the Eight Auspicious Symbols (八吉祥) so every group reads as one family.
// Decorative SVGs stay out of the accessibility tree; actions retain text labels.
const bell = '<path d="M12 2v3.4M12 2c-1.4.8-1.6 2.1-1 3.4M12 2c1.4.8 1.6 2.1 1 3.4M10 6.4h4"/><path d="M12 7.6c-3.4 0-4.4 2.6-4.4 6 0 2.9-.9 4.4-2.4 5.4h13.6c-1.5-1-2.4-2.5-2.4-5.4 0-3.4-1-6-4.4-6Z"/><path d="M7.5 16h9M12 19v2"/>';
const vajra = '<circle cx="12" cy="12" r="1.5"/><path d="M9.3 9.4h5.4M9.3 14.6h5.4M12 2.5v6.9m0 5.2v6.9M12 2.5c-3.2 1.2-3.6 4-2.7 6.9M12 2.5c3.2 1.2 3.6 4 2.7 6.9M12 21.5c-3.2-1.2-3.6-4-2.7-6.9m2.7 6.9c3.2-1.2 3.6-4 2.7-6.9"/>';
const paths = {
  // 金刚铃 · 金刚杵 · 铃杵（荟供）
  'ritual-bell': bell,
  vajra,
  'bell-vajra': `<g transform="translate(-3.4 1.2) scale(.9)">${bell}</g><g transform="translate(9.6 2.4) scale(.8)">${vajra}</g>`,
  // 莲花（佛菩萨）· 法轮（法会与修行月）· 宝伞（上师）· 胜利幢（节庆）· 日月（天象）· 宝瓶（其他）· 吉祥结（品牌）
  lotus: '<path d="M12 4.2c2.7 2.9 2.7 7.6 0 10.8-2.7-3.2-2.7-7.9 0-10.8Z"/><path d="M11 13.6C9.7 11 7.3 9.3 4.3 9.2c.8 3.6 3.9 5.8 7.7 5.8 3.8 0 6.9-2.2 7.7-5.8-3 .1-5.4 1.8-6.7 4.4"/><path d="M4.6 12.9C3.6 13.1 2.8 13.5 2 14c1.6 2.3 5.6 3.4 10 3.4s8.4-1.1 10-3.4c-.8-.5-1.6-.9-2.6-1.1"/><path d="M6.5 20.5h11"/>',
  wheel: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5V10m0 4v7.5M2.5 12H10m4 0h7.5M5.3 5.3l5.3 5.3m2.8 2.8 5.3 5.3m0-13.4-5.3 5.3m-2.8 2.8-5.3 5.3"/>',
  parasol: '<path d="M12 2v1.6"/><path d="M3.6 10.2C4.8 6 8 3.6 12 3.6s7.2 2.4 8.4 6.6"/><path d="M3.6 10.2c1.4 1.3 2.8 1.3 4.2 0 1.4 1.3 2.8 1.3 4.2 0 1.4 1.3 2.8 1.3 4.2 0 1.4 1.3 2.8 1.3 4.2 0"/><path d="M12 10.6v11M5.7 11.3v3m12.6-3v3"/>',
  banner: '<path d="M12 2v2.6"/><path d="M7.2 7.2C7.6 5.4 9.6 4.6 12 4.6s4.4.8 4.8 2.6"/><path d="M7.2 7.2v7.3m9.6-7.3v7.3M7.2 10.6h9.6"/><path d="M7.2 14.5c.8 1.2 1.6 1.2 2.4 0 .8 1.2 1.6 1.2 2.4 0 .8 1.2 1.6 1.2 2.4 0 .8 1.2 1.6 1.2 2.4 0"/><path d="M12 15.6V22m-3.4-6.5v3.3m6.8-3.3v3.3"/>',
  nyida: '<circle cx="12" cy="8.6" r="3.4"/><path d="M12 2.4v1"/><path d="M4.4 10.6c.4 4.7 3.6 8 7.6 8s7.2-3.3 7.6-8c-1.9 2.6-4.6 3.8-7.6 3.8s-5.7-1.2-7.6-3.8Z"/><path d="M8 21h8"/>',
  vase: '<path d="M12 1.8v1.4M9.6 3.4h4.8"/><path d="M10.4 3.4c0 1.9-1 2.6-1.6 3.1h6.4c-.6-.5-1.6-1.2-1.6-3.1"/><path d="M8.8 6.5C5.6 7.8 4.9 12.6 6.6 15.8 7.7 17.9 9.6 19 12 19s4.3-1.1 5.4-3.2c1.7-3.2 1-8-2.2-9.3"/><path d="M6.4 10c3.7 1.2 7.5 1.2 11.2 0M9.6 19l-.6 2.6h6l-.6-2.6"/>',
  knot: '<g transform="rotate(45 12 12)"><path d="M6.5 6.5h11v11h-11z"/><path d="M10.2 6.5v11M13.8 6.5v11M6.5 10.2h11M6.5 13.8h11"/><path d="M6.5 10.2C3.5 10.2 3.5 6.5 6.5 6.5M10.2 6.5c0-3 3.6-3 3.6 0M17.5 6.5c3 0 3 3.7 0 3.7M17.5 13.8c3 0 3 3.7 0 3.7M13.8 17.5c0 3-3.6 3-3.6 0M6.5 17.5c-3 0-3-3.7 0-3.7"/></g>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4m9-4v4M3.5 10h17m-12.5 4h2m4 0h2m-8 4h2"/>',
  'calendar-check': '<path d="M20.5 11V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6M7.5 3v4m9-4v4M3.5 10h17m-6 7 2.5 2.5 4.5-5"/>',
  'calendar-plus': '<path d="M20.5 11V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6M7.5 3v4m9-4v4M3.5 10h17M18 14v7m-3.5-3.5h7"/>',
  eclipse: '<circle cx="12" cy="12" r="6.5"/><path d="M13.5 5.7a6.5 6.5 0 0 0 0 12.6M12 2v1m0 18v1M2 12h1m18 0h1M5 5l.8.8m12.4 12.4.8.8M5 19l.8-.8M18.2 5.8 19 5"/>',
  person: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M3 21h18"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5.5-2 6-2 8h16c0-2-2-2.5-2-8ZM10 21h4M12 2v1"/>',
  'bell-settings': '<path d="M15 8.5a5 5 0 0 0-10 0c0 4.6-1.7 5-1.7 6.7h13.4c0-.8-.3-1.3-.7-2M8.5 19h3M10 2.5v1"/><circle cx="18.5" cy="9.5" r="2.5"/><path d="M18.5 5v2m0 5v2m4.5-4.5h-2m-5 0h-2"/>',
  'bell-off': '<path d="m3 3 18 18M9 3.8A6 6 0 0 1 18 9c0 2.2.3 3.6.8 4.7M6 8v1c0 5.5-2 6-2 8h13m-7 4h4"/>',
  sliders: '<path d="M4 6h4m4 0h8M4 18h8m4 0h4M8 3v6m8 6v6M4 12h11m4 0h1m-5-3v6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'
};
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.calendar}</svg>`;
}
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
}
