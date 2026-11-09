// Original 24-unit outlines on one grid and stroke. Practice categories draw on
// the Eight Auspicious Symbols (八吉祥) so every group reads as one family.
// Decorative SVGs stay out of the accessibility tree; actions retain text labels.
// Ritual symbols are drawn after traditional proportions (ghanta with half-vajra
// handle and lotus collar, five-prong vajra, eight-spoke wheel with jewel hub,
// …) and stay legible at 32–40px. Same 24 grid, stroke and round joins as the
// interface icons, so the family reads as one hand.
const bell = '<path d="M12 1.4v3M12 1.4c-1.5.7-1.8 2-1.2 3M12 1.4c1.5.7 1.8 2 1.2 3"/><path d="M10.4 4.6h3.2"/><circle cx="12" cy="5.9" r="1"/><path d="M9.9 7.9c.7-.8 1.4-.8 2.1 0 .7-.8 1.4-.8 2.1 0"/><path d="M12 7.9c-3.1 0-4.1 2.4-4.3 5.3-.2 2.6-1 4-2.7 5h14c-1.7-1-2.5-2.4-2.7-5-.2-2.9-1.2-5.3-4.3-5.3Z"/><path d="M7.8 14.6h8.4M5.2 20h13.6"/><path d="M12 20v1.2"/><circle cx="12" cy="22" r=".5"/>';
const vajra = '<circle cx="12" cy="12" r="1.3"/><path d="M9.7 9.5h4.6M9.7 14.5h4.6M10.6 10.9c.4.4.9.6 1.4.6s1-.2 1.4-.6M10.6 13.1c.4-.4.9-.6 1.4-.6s1 .2 1.4.6"/><path d="M12 9.5V2.2M12 2.2C8.6 3.7 8.3 7 9.7 9.5M12 2.2c3.4 1.5 3.7 4.8 2.3 7.3M12 4.2c-1.1 1.2-1.3 3.2-.7 5.3M12 4.2c1.1 1.2 1.3 3.2.7 5.3"/><path d="M12 14.5v7.3m0 0c-3.4-1.5-3.7-4.8-2.3-7.3m2.3 7.3c3.4-1.5 3.7-4.8 2.3-7.3M12 19.8c-1.1-1.2-1.3-3.2-.7-5.3m.7 5.3c1.1-1.2 1.3-3.2.7-5.3"/>';
const wheelSpokes = Array.from({length: 8}, (_, i) => {
  const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a), f = n => (12 + n).toFixed(2);
  const tip = a2 => [f(Math.cos(a2) * 8.1), f(Math.sin(a2) * 8.1)];
  const [x1, y1] = tip(a - .1), [x2, y2] = tip(a + .1);
  return `M${f(c * 2.3)} ${f(s * 2.3)}L${f(c * 6.7)} ${f(s * 6.7)}M${x1} ${y1}L${f(c * 9.9)} ${f(s * 9.9)}L${x2} ${y2}`;
}).join('');
const paths = {
  // 金刚铃 · 金刚杵 · 铃杵（荟供）
  'ritual-bell': bell,
  vajra,
  'bell-vajra': `<g class="i-bell" transform="translate(-3.2 .8) scale(.92)">${bell}</g><g class="i-vajra" transform="translate(10.2 2) scale(.82)">${vajra}</g>`,
  // 莲花（佛菩萨）· 法轮（法会与修行月）· 宝伞（上师）· 胜利幢（节庆）· 日月（天象）· 宝瓶（其他）· 吉祥结（品牌）
  lotus: '<path d="M12 4.6c2 2.1 2.4 5.6 0 9.2-2.4-3.6-2-7.1 0-9.2Z"/><path d="M11.2 13.6c-1.4-2.7-3.7-4.1-6.3-4 .3 3 2.8 4.9 6.3 5.1m1.6-1.1c1.4-2.7 3.7-4.1 6.3-4-.3 3-2.8 4.9-6.3 5.1"/><path d="M4.5 12.4c-1.2.3-2 .8-2.6 1.5 2 2.2 5.6 3.2 10.1 3.2s8.1-1 10.1-3.2c-.6-.7-1.4-1.2-2.6-1.5"/><path d="M5.6 18.6c1.8.9 4 1.3 6.4 1.3s4.6-.4 6.4-1.3M8.4 21.4h7.2"/>',
  wheel: `<circle cx="12" cy="12" r="6.7"/><circle cx="12" cy="12" r="8.1"/><circle cx="12" cy="12" r="2.3"/><circle cx="12" cy="12" r=".6"/><path d="${wheelSpokes}"/>`,
  parasol: '<circle cx="12" cy="2.1" r=".8"/><path d="M12 2.9v1"/><path d="M3.8 10.4C4.7 6.3 8 3.9 12 3.9s7.3 2.4 8.2 6.5"/><path d="M3.8 10.4c.7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0 .7.9 1.4.9 2.05 0"/><path d="M5.3 11.2c0 1.2-.3 2.2-.9 3M18.7 11.2c0 1.2.3 2.2.9 3M8.9 11.1v2.3M15.1 11.1v2.3"/><path d="M12 10.9v11.3M10.6 22.2h2.8"/>',
  banner: '<circle cx="12" cy="1.9" r=".8"/><path d="M12 2.7v1.1"/><path d="M7.6 6.6C8.2 4.8 9.9 3.8 12 3.8s3.8 1 4.4 2.8Z"/><path d="M8.3 6.6v8.2M15.7 6.6v8.2M8.3 9.4h7.4M8.3 12.1h7.4"/><path d="M8.3 14.8c.6.9 1.25.9 1.85 0 .6.9 1.25.9 1.85 0 .6.9 1.25.9 1.85 0 .6.9 1.25.9 1.85 0"/><path d="M9 15.8c-.3 1.5-1.2 2.5-2.5 3.1M15 15.8c.3 1.5 1.2 2.5 2.5 3.1"/><path d="M12 15.6v6.8"/>',
  nyida: '<path d="M12 2.1c.9.9 1 1.8 0 2.6-1-.8-.9-1.7 0-2.6Z"/><circle cx="12" cy="8.6" r="3.2"/><path d="M3.4 10.2c.9 5.3 4.4 8.6 8.6 8.6s7.7-3.3 8.6-8.6c-2.2 3.1-5.1 4.6-8.6 4.6s-6.4-1.5-8.6-4.6Z"/><path d="M8.2 21.4h7.6"/>',
  vase: '<circle cx="12" cy="2.2" r=".9"/><path d="M9.9 4.3h4.2"/><path d="M10.5 4.3c0 1.6-.6 2.5-1.7 3.1h6.4c-1.1-.6-1.7-1.5-1.7-3.1"/><path d="M8.8 7.4c-3.1 1.2-3.8 6-2 9.1 1.2 2 3 3 5.2 3s4-1 5.2-3c1.8-3.1 1.1-7.9-2-9.1"/><path d="M6.6 10.8c3.6 1.4 7.2 1.4 10.8 0M10.4 11.7l-.8 2.6M13.6 11.7l.8 2.6"/><path d="M9.7 19.5l-.7 2.1h6l-.7-2.1"/>',
  knot: '<g transform="rotate(45 12 12)"><path d="M7 7h10v10H7z"/><path d="M10.3 7v10M13.7 7v10M7 10.3h10M7 13.7h10"/><path d="M7 10.3C4.4 10.3 4.4 7 7 7M10.3 7c0-2.6 3.4-2.6 3.4 0M17 7c2.6 0 2.6 3.3 0 3.3M17 13.7c2.6 0 2.6 3.3 0 3.3M13.7 17c0 2.6-3.4 2.6-3.4 0M7 17c-2.6 0-2.6-3.3 0-3.3"/></g>',
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
const RITUAL = new Set(['ritual-bell','vajra','bell-vajra','lotus','wheel','parasol','banner','nyida','vase','knot']);
export function icon(name) {
  const known = name in paths ? name : 'calendar';
  // Ritual symbols carry finer detail, so they use a slightly finer line.
  const width = RITUAL.has(known) ? 1.4 : 1.6;
  return `<svg class="icon" data-icon-name="${known}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[known]}</svg>`;
}
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
}
