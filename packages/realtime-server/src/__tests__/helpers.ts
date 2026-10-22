export function ephemeralPort(): number {
  // 50000-60000 range — avoid privileged ports + common services.
  return 50000 + Math.floor(Math.random() * 10000);
}
