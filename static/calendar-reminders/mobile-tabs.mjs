// Each panel has its own reading position. This is interface state only: it
// never changes the subscription, the browsed month or the selected date.
export function createMobileTabs({onLayout = () => {}} = {}) {
  const tabs = document.querySelector('.mobile-tabs');
  const workspace = document.querySelector('.workspace');
  const buttons = [...tabs.querySelectorAll('[data-tab]')];
  const positions = new Map();
  const mobile = matchMedia('(max-width: 1023px)');
  let current = workspace.dataset.activeTab, restoring = 0;
  const pane = name => document.getElementById(`${name}-pane`);
  const tabHeight = () => mobile.matches ? tabs.getBoundingClientRect().height : 0;
  const pageTop = node => node.getBoundingClientRect().top + scrollY;
  function remember(name) {
    const root = pane(name), edge = tabHeight() + 12;
    const candidates = [...root.querySelectorAll('summary, .preset-card, .cal-control-bar, .cal-day-detail, .cal-list-day')];
    const anchor = candidates.find(node => node.getBoundingClientRect().bottom > edge && node.getBoundingClientRect().top > -innerHeight);
    positions.set(name, {node: anchor, top: anchor?.getBoundingClientRect().top, offset: scrollY - pageTop(root)});
  }
  function switchTo(next, {focus = false, top = false} = {}) {
    if (next !== current) {
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
        const position = top ? null : positions.get(next);
        const target = next === 'preview' ? pane(next).querySelector('.cal-control-bar') : pane(next);
        const y = position?.node?.isConnected && pane(next).contains(position.node)
          ? pageTop(position.node) - position.top
          : position ? pageTop(pane(next)) + position.offset : pageTop(target) - tabHeight() - 12;
        // Both panels use normal document scrolling; prevent anchor adjustments
        // during the visibility change from overriding the chosen position.
        cancelAnimationFrame(restoring);
        scrollTo({top: Math.max(0, y), behavior: 'auto'});
        restoring = requestAnimationFrame(() => scrollTo({top: Math.max(0, y), behavior: 'auto'}));
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
