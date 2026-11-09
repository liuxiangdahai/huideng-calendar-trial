// Feedback follows completed UI changes; it never gates state, focus or saving.
// Only transform/opacity are animated. No scroll listeners or permanent loops.
const contexts = new WeakMap();
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function contextFor(doc) {
  if (contexts.has(doc)) return contexts.get(doc);
  const preference = doc.defaultView.matchMedia(reducedMotionQuery);
  const active = new Map();
  const cancel = () => { for (const animation of active.values()) animation.cancel(); active.clear(); };
  const changed = event => { if (event.matches) cancel(); };
  if (preference.addEventListener) preference.addEventListener('change', changed);
  else preference.addListener?.(changed);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel(); });
  doc.defaultView.addEventListener('pagehide', cancel);
  const context = {preference, active};
  contexts.set(doc, context);
  return context;
}

export function playMotion(node, kind = 'reveal', direction = 1) {
  if (!node?.isConnected || typeof node.animate !== 'function') return;
  const doc = node.ownerDocument, {active} = contextFor(doc);
  // A new action replaces any unfinished feedback, rather than queuing it.
  for (const [target, animation] of active) {
    if (target === node || !target.isConnected) { animation.cancel(); active.delete(target); }
  }
  // Firefox can update a retained MediaQueryList one rendering turn after a
  // fresh query. Check the current preference for each action; the retained
  // query still cancels in-flight effects when its change event arrives.
  if (doc.defaultView.matchMedia(reducedMotionQuery).matches || doc.hidden || node.closest('[hidden]')) return;
  const frames = kind === 'check'
    ? [{transform:'scale(.82)'}, {transform:'scale(1.08)',offset:.65}, {transform:'scale(1)'}]
    : kind === 'month'
      ? [{opacity:.65,transform:`translateX(${direction * 8}px)`}, {opacity:1,transform:'translateX(0)'}]
      : kind === 'fade'
        ? [{opacity:.65}, {opacity:1}]
        : kind === 'view'
          ? [{opacity:0,transform:'translateY(6px)'}, {opacity:1,transform:'translateY(0)'}]
        : kind === 'pane'
          ? [{opacity:.4,transform:`translateX(${direction * 14}px)`}, {opacity:1,transform:'translateX(0)'}]
        : kind === 'appear'
          ? [{opacity:0,transform:'scale(.9)'}, {opacity:1,transform:'scale(1)'}]
        : kind === 'nudge'
          ? [{transform:'scale(1)'}, {transform:'scale(1.035)',offset:.45}, {transform:'scale(1)'}]
        : [{opacity:.65,transform:'translateY(6px)'}, {opacity:1,transform:'translateY(0)'}];
  try {
    const duration = {month:200, view:240, pane:220, appear:220, nudge:460}[kind] || 180;
    const animation = node.animate(frames, {duration, easing:'cubic-bezier(.2,.7,.2,1)'});
    animation.id = `calendar-${kind}`;
    active.set(node, animation);
    const clean = () => { if (active.get(node) === animation) active.delete(node); };
    animation.finished.then(clean, clean);
  } catch { /* Older browsers retain the completed, fully usable UI. */ }
}

// Smooth a container whose content was just swapped: grow or shrink from the
// previous height instead of snapping. Purely visual; layout is already final.
export function playResize(node, fromHeight) {
  if (!node?.isConnected || typeof node.animate !== 'function') return;
  const doc = node.ownerDocument, {active} = contextFor(doc);
  if (doc.defaultView.matchMedia(reducedMotionQuery).matches || doc.hidden) return;
  const to = node.getBoundingClientRect().height;
  if (!Number.isFinite(fromHeight) || Math.abs(to - fromHeight) < 2) return;
  for (const [target, animation] of active) if (target === node) { animation.cancel(); active.delete(target); }
  try {
    const animation = node.animate([{height:`${fromHeight}px`, overflow:'hidden'}, {height:`${to}px`, overflow:'hidden'}],
      {duration:240, easing:'cubic-bezier(.2,.7,.2,1)'});
    animation.id = 'calendar-resize';
    active.set(node, animation);
    const clean = () => { if (active.get(node) === animation) active.delete(node); };
    animation.finished.then(clean, clean);
  } catch { /* The final height is already in place. */ }
}

export function installDisclosureMotion(doc = document) {
  // Native details stay responsible for accessibility and opening immediately.
  // Arm only user-activated summaries; restored/re-rendered open groups stay still.
  const armed = new WeakSet();
  doc.addEventListener('click', event => {
    const summary = event.target.closest?.('summary');
    if (summary?.parentElement?.tagName === 'DETAILS') armed.add(summary.parentElement);
  });
  doc.addEventListener('toggle', event => {
    const details = event.target;
    if (!armed.has(details)) return;
    armed.delete(details);
    if (!details.open) return;
    for (const child of details.children) if (child.tagName !== 'SUMMARY') playMotion(child, 'fade');
  }, true);
}
