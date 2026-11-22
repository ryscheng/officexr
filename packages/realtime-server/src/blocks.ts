import { loginOf, type PlayerId } from '@officexr/sdk';

export interface BlocksApi {
  blockedBy: (login: string) => Promise<string[]>;
}

export class BlockIndex {
  private readonly blocked = new Map<string, ReadonlySet<string>>();

  set(login: string, blockedLogins: Iterable<string>): void {
    this.blocked.set(login, new Set(blockedLogins));
  }

  forget(login: string): void {
    this.blocked.delete(login);
  }

  hides(a: PlayerId, b: PlayerId): boolean {
    const [la, lb] = [loginOf(a), loginOf(b)];
    return (this.blocked.get(la)?.has(lb) ?? false) || (this.blocked.get(lb)?.has(la) ?? false);
  }
}
