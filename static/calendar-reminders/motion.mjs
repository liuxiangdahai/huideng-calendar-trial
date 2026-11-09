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

// Each ritual symbol answers a choice the way the object itself moves: the
// bell swings from its handle, the wheel turns, the lotus opens, the parasol
// spreads, the banner ripples, the sun rises from the moon, the vase settles.
// One short play per tap; transform only; skipped under reduced motion.
const SYMBOL_MOTION = {
  'ritual-bell': {origin:'50% 8%', duration:720, frames:[0,16,-12,7,-3,0].map(d => ({transform:`rotate(${d}deg)`}))},
  'bell-vajra': {origin:'40% 10%', duration:640, frames:[0,10,-8,4,0].map(d => ({transform:`rotate(${d}deg)`}))},
  vajra: {origin:'50% 50%', duration:560, frames:[{transform:'rotate(0)'}, {transform:'rotate(-14deg)'}, {transform:'rotate(6deg)'}, {transform:'rotate(0)'}]},
  wheel: {origin:'50% 50%', duration:900, frames:[{transform:'rotate(0)'}, {transform:'rotate(360deg)'}], easing:'cubic-bezier(.3,.6,.2,1)'},
  lotus: {origin:'50% 90%', duration:560, frames:[{transform:'scale(.82)'}, {transform:'scale(1.08)', offset:.6}, {transform:'scale(1)'}]},
  parasol: {origin:'50% 15%', duration:560, frames:[{transform:'scaleX(.8)'}, {transform:'scaleX(1.06)', offset:.6}, {transform:'scaleX(1)'}]},
  banner: {origin:'50% 5%', duration:640, frames:[0,-7,5,-2,0].map(d => ({transform:`skewX(${d}deg)`}))},
  nyida: {origin:'50% 50%', duration:560, frames:[{transform:'translateY(3px)', opacity:.6}, {transform:'translateY(-1px)', opacity:1, offset:.6}, {transform:'translateY(0)'}]},
  vase: {origin:'50% 100%', duration:520, frames:[{transform:'translateY(0) rotate(0)'}, {transform:'translateY(-3px) rotate(-4deg)', offset:.4}, {transform:'translateY(0) rotate(2deg)', offset:.75}, {transform:'translateY(0) rotate(0)'}]},
  knot: {origin:'50% 50%', duration:600, frames:[{transform:'rotate(0) scale(1)'}, {transform:'rotate(45deg) scale(.92)', offset:.5}, {transform:'rotate(90deg) scale(1)'}]},
  eclipse: {origin:'50% 50%', duration:600, frames:[{opacity:1}, {opacity:.45, offset:.5}, {opacity:1}]}
};
export function playSymbol(svg) {
  const spec = SYMBOL_MOTION[svg?.dataset?.iconName];
  if (!spec || !svg.isConnected || typeof svg.animate !== 'function') return;
  const doc = svg.ownerDocument, {active} = contextFor(doc);
  if (doc.defaultView.matchMedia(reducedMotionQuery).matches || doc.hidden) return;
  for (const [target, animation] of active) if (target === svg) { animation.cancel(); active.delete(target); }
  try {
    svg.style.transformOrigin = spec.origin;
    const animation = svg.animate(spec.frames, {duration: spec.duration, easing: spec.easing || 'cubic-bezier(.3,.7,.3,1)'});
    animation.id = 'calendar-symbol';
    active.set(svg, animation);
    const clean = () => { if (active.get(svg) === animation) active.delete(svg); };
    animation.finished.then(clean, clean);
  } catch { /* Static symbol remains. */ }
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
