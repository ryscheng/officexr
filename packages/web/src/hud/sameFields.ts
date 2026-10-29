export const sameFields = <T extends object>(a: T, b: T) =>
  (Object.keys(a) as (keyof T)[]).every((k) => Object.is(a[k], b[k]));

export const sameList = <T extends object>(a: T[], b: T[]) =>
  a.length === b.length && a.every((x, i) => sameFields(x, b[i]));
