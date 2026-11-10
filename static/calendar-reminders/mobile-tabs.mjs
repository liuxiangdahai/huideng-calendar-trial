import {playMotion} from './motion.mjs';

// Each panel has its own reading position. This is interface state only: it
// never changes the subscription, the browsed month or the selected date.
export function createMobileTabs({onLayout = () => {}} = {}) {
  const tabs = document.querySelector('.mobile-tabs');
  const workspace = document.querySelector('.workspace');
  const buttons = [...tabs.querySelectorAll('[data-tab]')];
  const positions = new Map();
  const mobile = matchMedia('(max-width: 1023px)');
  let current = workspace.dataset.activeTab;
  const pane = name => document.getElementById(`${name}-pane`);
  const tabHeight = () => mobile.matches ? tabs.getBoundingClientRect().height : 0;
  const pageTop = node => node.getBoundingClientRect().top + scrollY;
  // Scroll position at which the tab bar sticks and a pane starts just below it.
  // Both panes share this spot. Measured on the visible pane (a hidden one has no box).
  const stickPoint = name => pageTop(pane(name)) - tabHeight() - 12;
  // Whether the bar is pinned is read from the bar itself (sticky at top 0).
  // Comparing scrollY with a computed stick point failed whenever the preview
  // shifted a pixel or two after rendering: the reader's place was then lost
  // on the way back (intermittent in WebKit, 11-10).
  const stuck = () => mobile.matches && tabs.getBoundingClientRect().top <= 1;
  function remember(name) {
    // Banner still showing: nothing to restore, the reader is at the pane's start.
    if (!stuck()) { positions.delete(name); return; }
    const root = pane(name), edge = tabHeight() + 12;
    const candidates = [...root.querySelectorAll('summary, .preset-card, .cal-control-bar, .cal-day-detail, .cal-list-day')];
    const anchor = candidates.find(node => node.getBoundingClientRect().bottom > edge && node.getBoundingClientRect().top > -innerHeight);
    positions.set(name, {node: anchor, top: anchor?.getBoundingClientRect().top, offset: scrollY - pageTop(root)});
  }
  function switchTo(next, {focus = false, top = false} = {}) {
    if (next !== current) {
      // Read before the swap: hiding a pane lets WebKit reset the scroll
      // position on its own (it landed at 23px whatever the start point).
      const before = scrollY, wasStuck = stuck();
      if (mobile.matches) remember(current);
      current = next;
      workspace.dataset.activeTab = next;
      buttons.forEach(button => {
        const active = button.dataset.tab === next;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      onLayout();
      if (mobile.matches) {
        // The tab bar must not move when tapped (11-10: switching from the top
        // of the page used to scroll 188px down, and back up on return). While
        // the banner is still visible keep the page where it is; once the bar
        // is stuck, restore the reader's place in that pane, never above the
        // stick point, so the bar stays pinned in the same spot.
        // A place remembered in the other pane always wins, even when this
        // pane is too short to pin the bar (a month with fewer weeks).
        const position = top ? null : positions.get(next);
        if (position) {
          const y = position.node?.isConnected && pane(next).contains(position.node)
            ? pageTop(position.node) - position.top : pageTop(pane(next)) + position.offset;
          scrollTo({top: Math.max(stickPoint(next), y), behavior: 'auto'});
        } else scrollTo({top: wasStuck ? stickPoint(next) : before, behavior: 'auto'});
        // A short slide from the side the tab sits on; transform only, so
        // remembered anchors and sticky geometry stay unchanged.
        playMotion(pane(next),'pane',next === 'preview' ? 1 : -1);
      }
    }
    if (focus) buttons.find(button => button.dataset.tab === next)?.focus({preventScroll: true});
  }
  buttons.forEach(button => button.addEventListener('click', () => switchTo(button.dataset.tab)));
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (!event.target.matches('[data-tab]')) return;
    event.preventDefault();
    switchTo(event.key === 'Home' ? 'selection' : event.key === 'End' ? 'preview' : current === 'selection' ? 'preview' : 'selection', {focus: true});
  });
  const storeHeight = height => {
    const value=`${height}px`;
    if(document.documentElement.style.getPropertyValue('--tabs-height')!==value)
      document.documentElement.style.setProperty('--tabs-height',value);
  };
  if (globalThis.ResizeObserver) new ResizeObserver(entries => {
    const entry=entries[0];storeHeight(entry.borderBoxSize?.[0]?.blockSize ?? tabHeight());
  }).observe(tabs);
  else {const updateHeight=()=>storeHeight(tabHeight());addEventListener('resize',updateHeight);requestAnimationFrame(updateHeight);}
  return {switchTo};
}
