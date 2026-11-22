export const COMPONENT_PROBE = `(() => {
  const PERFORMED_WORK = 1;
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  let acc = {};
  const nameOf = (type) => {
    if (!type) return 'Unknown';
    if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
    if (type.displayName) return type.displayName;
    if (type.render) return nameOf(type.render);
    if (type.type) return nameOf(type.type);
    return 'Unknown';
  };
  const labelOf = (fiber) => {
    const own = nameOf(fiber.type);
    if (own !== 'Anonymous') return own;
    const parents = [];
    for (let p = fiber.return; p && parents.length < 3; p = p.return) {
      if (COMPONENT_TAGS.has(p.tag)) {
        const n = nameOf(p.type);
        if (n !== 'Anonymous') parents.push(n);
      }
    }
    return 'Anonymous < ' + parents.join(' < ');
  };
  const childMs = (fiber) => {
    let sum = 0;
    for (let c = fiber.child; c; c = c.sibling) sum += c.actualDuration || 0;
    return sum;
  };
  const visit = (fiber) => {
    for (let f = fiber; f; ) {
      if (COMPONENT_TAGS.has(f.tag) && f.flags & PERFORMED_WORK) {
        const name = labelOf(f);
        const entry = (acc[name] ??= { renders: 0, selfMs: 0, ownTriggered: 0 });
        entry.renders++;
        if (f.alternate && f.alternate.memoizedProps === f.memoizedProps) {
          entry.ownTriggered++;
          const changed = ((entry.changedHooks ??= {}));
          let a = f.memoizedState;
          let b = f.alternate.memoizedState;
          for (let i = 0; a && b; i++, a = a.next, b = b.next) {
            const v = a.memoizedState;
            if (v && typeof v === 'object' && 'create' in v) continue;
            if (!Object.is(v, b.memoizedState)) { changed[i] = (changed[i] || 0) + 1; try { (entry.sample ??= {})[i] = JSON.stringify(v).slice(0, 100); } catch { /* cyclic */ } }
          }
        }
        entry.selfMs += Math.max(0, (f.actualDuration || 0) - childMs(f));
      }
      if (f.child) {
        f = f.child;
        continue;
      }
      while (f && !f.sibling) f = f.return;
      if (f) f = f.sibling;
    }
  };
  window.__componentsReset = () => { acc = {}; };
  window.__componentsRead = () => acc;
  return (root) => visit(root.current);
})()`;
