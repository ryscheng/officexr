/** Whole metres rounded down, `<1 m` under one. */
export const formatDistance = (metres: number) => (metres < 1 ? '<1 m' : `${Math.floor(metres)} m`);
