// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JaasVoiceAdapter } from './JaasVoiceAdapter';
import { useMuteHotkey } from './useMuteHotkey';

function Harness({ voice }: { voice: JaasVoiceAdapter }) {
  useMuteHotkey(voice);
  return <input aria-label="chat" />;
}

const adapter = () => new JaasVoiceAdapter({ appId: 'app', jwt: Promise.resolve('jwt'), displayName: 'Me' });

describe('useMuteHotkey', () => {
  afterEach(cleanup);

  it('toggles the mic on Alt+M', () => {
    const voice = adapter();
    render(<Harness voice={voice} />);
    fireEvent.keyDown(window, { code: 'KeyM', altKey: true });
    expect(voice.isMicMuted()).toBe(true);
    fireEvent.keyDown(window, { code: 'KeyM', altKey: true });
    expect(voice.isMicMuted()).toBe(false);
  });

  it('ignores a bare M and keys typed into a text field', () => {
    const voice = adapter();
    const { getByLabelText } = render(<Harness voice={voice} />);
    fireEvent.keyDown(window, { code: 'KeyM' });
    fireEvent.keyDown(getByLabelText('chat'), { code: 'KeyM', altKey: true });
    expect(voice.isMicMuted()).toBe(false);
  });
});
