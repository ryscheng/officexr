import { describe, expect, it } from 'vitest';
import { enteringCopy, enteringTitle } from './enteringStage';

describe('enteringCopy', () => {
  it('names each of the four steps with a hint for the next', () => {
    expect(enteringCopy(1)).toMatchObject({ step: 'Step 1 of 4: checking your sign-in', hint: 'Then: finding your office' });
    expect(enteringCopy(2)).toMatchObject({ step: 'Step 2 of 4: finding your office', hint: 'Then: joining the room' });
    expect(enteringCopy(3)).toMatchObject({ step: 'Step 3 of 4: joining the room', hint: 'Then: loading the 3D view' });
    expect(enteringCopy(4)).toMatchObject({ step: 'Step 4 of 4: loading the 3D view', hint: undefined });
  });

  it('never moves the bar back as the step grows', () => {
    const values = ([1, 2, 3, 4] as const).map((s) => enteringCopy(s).progress);
    expect(values).toEqual([25, 50, 75, 100]);
  });

  it('titles with the office name once known', () => {
    expect(enteringTitle()).toBe('Opening your office');
    expect(enteringTitle('Design studio')).toBe('Opening Design studio');
  });
});
