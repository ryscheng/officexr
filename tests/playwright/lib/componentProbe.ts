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
  const childMs = (fiber) => {
    let sum = 0;
    for (let c = fiber.child; c; c = c.sibling) sum += c.actualDuration || 0;
    return sum;
  };
  const visit = (fiber) => {
    for (let f = fiber; f; ) {
      if (COMPONENT_TAGS.has(f.tag) && f.flags & PERFORMED_WORK) {
        const name = nameOf(f.type);
        const entry = (acc[name] ??= { renders: 0, selfMs: 0 });
        entry.renders++;
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
