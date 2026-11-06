/** Only the creator of a debug-enabled office may hold several live sessions in it. */
export function officeAllowsMultiSession(
  office: { debug_enabled?: unknown; created_by_login?: unknown },
  login: string,
): boolean {
  return office.debug_enabled === true && office.created_by_login === login;
}
