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
// bell swings from its handle, the vajra turns in the hand, the wheel turns,
// the lotus blooms petal by petal, the parasol opens, the banner ripples in
// the wind, the sun rises from the moon, the vase settles, the endless knot
// draws itself, the eclipse passes. Parts are animated (not the whole icon)
// with transform/opacity/dash only; one short play per tap; skipped under
// reduced motion. A spec is a list of tracks: [part selector, origin, frames, timing].
const ease = 'cubic-bezier(.3,.7,.3,1)';
const swing = deg => deg.map(d => ({transform: `rotate(${d}deg)`}));
const SYMBOL_MOTION = {
  'ritual-bell': [['.s-swing', '50% 0%', swing([0, 18, -13, 8, -4, 0]), {duration: 820}]],
  'bell-vajra': [['.s-swing', '50% 0%', swing([0, 16, -11, 6, 0]), {duration: 760}],
    ['.s-tilt', '50% 50%', swing([0, -18, 8, 0]), {duration: 620, delay: 120}]],
  vajra: [['.s-spin', '50% 50%', swing([0, 200, 180]), {duration: 760}]],
  wheel: [['.s-turn', '50% 50%', [{transform: 'rotate(0)'}, {transform: 'rotate(360deg)'}], {duration: 1000, easing: 'cubic-bezier(.25,.6,.2,1)'}]],
  lotus: [
    ['.s-center', '50% 100%', [{transform: 'scaleY(.3)', opacity: .2}, {transform: 'scaleY(1.06)', opacity: 1, offset: .7}, {transform: 'scaleY(1)'}], {duration: 620}],
    ['.s-left', '100% 100%', [{transform: 'rotate(34deg) scale(.7)', opacity: 0}, {transform: 'rotate(-4deg) scale(1.03)', opacity: 1, offset: .7}, {transform: 'rotate(0) scale(1)'}], {duration: 680, delay: 90}],
    ['.s-right', '0% 100%', [{transform: 'rotate(-34deg) scale(.7)', opacity: 0}, {transform: 'rotate(4deg) scale(1.03)', opacity: 1, offset: .7}, {transform: 'rotate(0) scale(1)'}], {duration: 680, delay: 90}],
    ['.s-outer', '50% 100%', [{transform: 'scaleX(.5) scaleY(.6)', opacity: 0}, {transform: 'scaleX(1.04) scaleY(1)', opacity: 1, offset: .7}, {transform: 'scale(1)'}], {duration: 700, delay: 200}]],
  parasol: [['.s-canopy', '50% 0%', [{transform: 'scaleX(.18) scaleY(.75)'}, {transform: 'scaleX(1.07) scaleY(1)', offset: .65}, {transform: 'scale(1)'}], {duration: 700, easing: 'cubic-bezier(.2,.8,.25,1)'}]],
  banner: [['.s-cloth', '50% 0%', [0, -8, 6, -3, 1, 0].map(d => ({transform: `skewX(${d}deg)`})), {duration: 900}]],
  nyida: [['.s-sun', '50% 50%', [{transform: 'translateY(5px)', opacity: 0}, {transform: 'translateY(-1px)', opacity: 1, offset: .7}, {transform: 'translateY(0)'}], {duration: 720}]],
  vase: [['.s-vase', '50% 100%', [{transform: 'translateY(0) rotate(0)'}, {transform: 'translateY(-3px) rotate(-5deg)', offset: .35}, {transform: 'translateY(0) rotate(3deg)', offset: .7}, {transform: 'translateY(0) rotate(0)'}], {duration: 620}]],
  knot: [['path', null, [{strokeDasharray: '1', strokeDashoffset: 1}, {strokeDasharray: '1', strokeDashoffset: 0}], {duration: 900, stagger: 120}]],
  eclipse: [['.s-shadow', '50% 50%', [{transform: 'translateX(-6px)', opacity: 0}, {transform: 'translateX(0)', opacity: 1}], {duration: 700}],
    ['.s-rays', '50% 50%', [{transform: 'rotate(-30deg)', opacity: .3}, {transform: 'rotate(0)', opacity: 1}], {duration: 700}]],
  calendar: [[null, '50% 30%', [{transform: 'perspective(60px) rotateX(0)'}, {transform: 'perspective(60px) rotateX(-55deg)', offset: .4}, {transform: 'perspective(60px) rotateX(0)'}], {duration: 560}]]
};
export function playSymbol(svg) {
  const tracks = SYMBOL_MOTION[svg?.dataset?.iconName];
  if (!tracks || !svg.isConnected || typeof svg.animate !== 'function') return;
  const doc = svg.ownerDocument, {active} = contextFor(doc);
  if (doc.defaultView.matchMedia(reducedMotionQuery).matches || doc.hidden) return;
  for (const [selector, origin, frames, timing] of tracks) {
    const parts = selector ? [...svg.querySelectorAll(selector)] : [svg];
    parts.forEach((part, index) => {
      for (const [target, animation] of active) if (target === part) { animation.cancel(); active.delete(target); }
      try {
        if (origin) { part.style.transformOrigin = origin; if (part !== svg) part.style.transformBox = 'fill-box'; }
        const animation = part.animate(frames, {duration: timing.duration, delay: (timing.delay || 0) + index * (timing.stagger || 0),
          easing: timing.easing || ease, fill: 'backwards'});
        animation.id = 'calendar-symbol';
        active.set(part, animation);
        const clean = () => { if (active.get(part) === animation) active.delete(part); };
        animation.finished.then(clean, clean);
      } catch { /* Static symbol remains. */ }
    });
  }
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
