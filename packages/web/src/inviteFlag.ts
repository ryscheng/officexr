const PARAM = 'invite';

export const roomPath = (id: string, { welcome = false } = {}) => `/room/${encodeURIComponent(id)}${welcome ? `?${PARAM}=1` : ''}`;

export const hasInviteFlag = (search: string) => new URLSearchParams(search).get(PARAM) === '1';

export function withoutInviteFlag(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
