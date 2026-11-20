import { expect, it, vi } from 'vitest';
import { ActionInput, type MobileActionContext } from '@officexr/world/react';
import { statusMobileActions } from './mobileStatusActions';

const ctx = (): MobileActionContext => ({ interact: null, input: new ActionInput() });

it('calls the same functions as the H and R keys', () => {
  const toggleHand = vi.fn();
  const toggleEmotePicker = vi.fn();
  const [emote, hand] = statusMobileActions({ handRaised: false, toggleHand, toggleEmotePicker });
  emote!.onPress(ctx());
  hand!.onPress(ctx());
  expect(toggleEmotePicker).toHaveBeenCalledTimes(1);
  expect(toggleHand).toHaveBeenCalledTimes(1);
});

it('lights the hand button and relabels it while the hand is raised', () => {
  const noop = () => {};
  const [, up] = statusMobileActions({ handRaised: true, toggleHand: noop, toggleEmotePicker: noop });
  const [, down] = statusMobileActions({ handRaised: false, toggleHand: noop, toggleEmotePicker: noop });
  expect(up!.active?.(ctx())).toBe(true);
  expect(down!.active?.(ctx())).toBe(false);
  expect(up!.label).toBe('Lower hand');
  expect(down!.label).toBe('Hand');
});
