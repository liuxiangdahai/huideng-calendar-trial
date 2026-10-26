// Original 24-unit outlines, shared by navigation, categories and guidance.
// Decorative SVGs stay out of the accessibility tree; actions retain text labels.
const ritualBell = '<path d="M12 2v6M12 2c-3 1-3.5 3-2 5m2-5c3 1 3.5 3 2 5M10 8h4m-4 2h4M12 10c-5 0-4 6-7 9h14c-3-3-2-9-7-9ZM5 21h14M8 16h8"/>';
const paths = {
  'ritual-bell': ritualBell,
  'bell-vajra': `<g transform="translate(-1 3) scale(.78)">${ritualBell}</g><g transform="rotate(12 19 11)"><ellipse cx="19" cy="11" rx="1.2" ry="1"/><path d="M16.8 8.8h4.4m-4.4 4.4h4.4M19 2v6.8m0 4.4V20M19 2c-3.4 1.5-3.5 3.5-2.2 6.8M19 2c3.4 1.5 3.5 3.5 2.2 6.8M19 20c-3.4-1.5-3.5-3.5-2.2-6.8M19 20c3.4-1.5 3.5-3.5 2.2-6.8"/></g>`,
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4m9-4v4M3.5 10h17m-12.5 4h2m4 0h2m-8 4h2"/>',
  'calendar-check': '<path d="M20.5 11V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6M7.5 3v4m9-4v4M3.5 10h17m-6 7 2.5 2.5 4.5-5"/>',
  'calendar-plus': '<path d="M20.5 11V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6M7.5 3v4m9-4v4M3.5 10h17M18 14v7m-3.5-3.5h7"/>',
  // A central bead between lotus collars and two closed, five-pronged crowns.
  vajra: '<g transform="rotate(35 12 12)"><ellipse cx="12" cy="12" rx="1.7" ry="1.4"/><path d="M9.2 9.2h5.6m-5.6 5.6h5.6M12 2v7.2m0 5.6V22M12 2C8 3.2 7.5 5.2 9.2 9.2M12 2c4 1.2 4.5 3.2 2.8 7.2M12 2C10 4.4 10 6.8 10.5 9.2M12 2c2 2.4 2 4.8 1.5 7.2M12 22c-4-1.2-4.5-3.2-2.8-7.2M12 22c4-1.2 4.5-3.2 2.8-7.2M12 22c-2-2.4-2-4.8-1.5-7.2M12 22c2-2.4 2-4.8 1.5-7.2"/></g>',
  'woven-seal': '<path d="m12 2 4 4-4 4-4-4 4-4Zm0 12 4 4-4 4-4-4 4-4ZM2 12l4-4 4 4-4 4-4-4Zm12 0 4-4 4 4-4 4-4-4ZM8 8l8 8m0-8-8 8"/>',
  lotus: '<path d="M12 19C6.8 19 3 15.6 3 10c3.4.1 6.6 2.2 9 6 2.4-3.8 5.6-5.9 9-6 0 5.6-3.8 9-9 9Zm0-3c-3.6-3.6-3.6-7.7 0-12 3.6 4.3 3.6 8.4 0 12ZM6.2 7l.8 4.1M17.8 7l-.8 4.1M7 21h10"/>',
  throne: '<path d="M6.5 16V9c0-3.6 2.4-6 5.5-7 3.1 1 5.5 3.4 5.5 7v7M5 12H3.5v5h17v-5H19M6 17v3m12-3v3M4 21h16M8.5 10v3h7v-3M9 6.5h6"/>',
  pecha: '<rect x="3" y="6" width="18" height="10" rx="1.5"/><path d="M7 6v10m10-10v10M10 10h4m-4 3h4M4 19h16M5 21h14"/>',
  festival: '<rect x="3.5" y="6" width="17" height="15" rx="2"/><path d="M3.5 11h17M7.5 3.5V8m9-4.5V8m-8 8 3.5-3 3.5 3-3.5 3-3.5-3ZM10 3h4"/>',
  'sun-moon': '<path d="M19 15.3a7.8 7.8 0 0 1-10.3-10A7.9 7.9 0 1 0 19 15.3Z"/><circle cx="17" cy="6" r="2.5"/><path d="M17 1v1m0 8v1m-5-5h1m8 0h1m-1.5-3.5-.7.7m-7.1 6.4.8-.8"/>',
  eclipse: '<circle cx="12" cy="12" r="6.5"/><path d="M13.5 5.7a6.5 6.5 0 0 0 0 12.6M12 2v1m0 18v1M2 12h1m18 0h1M5 5l.8.8m12.4 12.4.8.8M5 19l.8-.8M18.2 5.8 19 5"/>',
  person: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M3 21h18"/>',
  book: '<path d="M12 5v16M3 4c4-1 7-1 9 1 2-2 5-2 9-1v15c-4-1-7-1-9 2-2-3-5-3-9-2V4Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5.5-2 6-2 8h16c0-2-2-2.5-2-8ZM10 21h4M12 2v1"/>',
  'bell-settings': '<path d="M13 7a4.5 4.5 0 0 0-9 0c0 4-1.5 4.5-1.5 6h10.8M7 17h3M8.5 1v1.5M16 5h6M16 12h6M13 19h9M18 3v4m2 3v4m-4 3v4"/>',
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
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3L17 8.5"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
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
