import type { ChatMessage, ChatScope, PlayerId } from '@officexr/sdk';

export type ChatTarget = { type: 'everyone' } | { type: 'nearby' } | { type: 'direct'; id: PlayerId };

export const EVERYONE: ChatTarget = { type: 'everyone' };

export const targetValue = (target: ChatTarget) => (target.type === 'direct' ? `direct:${target.id}` : target.type);

export function parseTarget(value: string): ChatTarget {
  if (value === 'nearby') {
    return { type: 'nearby' };
  }
  return value.startsWith('direct:') ? { type: 'direct', id: value.slice('direct:'.length) } : EVERYONE;
}

export const scopeOfTarget = (target: ChatTarget): Pick<ChatMessage, 'scope' | 'to'> =>
  target.type === 'direct' ? { scope: 'direct', to: target.id } : target.type === 'nearby' ? { scope: 'nearby' } : {};

export function scopeTag(message: Pick<ChatMessage, 'scope' | 'to'>, selfId: PlayerId, nameOf: (id: PlayerId) => string): string | null {
  const scope: ChatScope | undefined = message.scope;
  if (scope === 'nearby') {
    return 'nearby';
  }
  if (scope === 'direct') {
    return message.to && message.to !== selfId ? `private, to ${nameOf(message.to)}` : 'private';
  }
  return null;
}

export function placeholderFor(target: ChatTarget, officeName: string, nameOf: (id: PlayerId) => string): string {
  if (target.type === 'nearby') {
    return 'Message people nearby';
  }
  return target.type === 'direct' ? `Message ${nameOf(target.id)}` : `Message ${officeName || 'everyone'}`;
}
