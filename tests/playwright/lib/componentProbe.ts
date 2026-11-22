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
  const entryOf = (name) => (acc[name] ??= { renders: 0, selfMs: 0, ownTriggered: 0 });
  let performed = 0;
  const count = (f) => {
    performed++;
    const entry = entryOf(labelOf(f));
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
  };
  const visit = (next, prev, parentRendered) => {
    let rendered = parentRendered;
    if (COMPONENT_TAGS.has(next.tag) && next.flags & PERFORMED_WORK) {
      count(next);
      if (!parentRendered) entryOf('(starts ' + labelOf(next) + ')').renders++;
      rendered = true;
    }
    if (next.child === (prev && prev.child)) return;
    const before = new Set();
    for (let c = prev && prev.child; c; c = c.sibling) before.add(c);
    for (let c = next.child; c; c = c.sibling) {
      if (!before.has(c)) visit(c, c.alternate, rendered);
    }
  };
  window.__componentsReset = () => { acc = {}; };
  window.__componentsRead = () => acc;
  return (root) => {
    const before = performed;
    visit(root.current, root.current.alternate, false);
    const ci = root.containerInfo;
    entryOf('(commit ' + (ci && ci.nodeName ? 'dom' : 'r3f') + (performed === before ? ', no component' : '') + ')').renders++;
  };
})()`;
