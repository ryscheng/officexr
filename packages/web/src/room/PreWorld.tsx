import { WorldLoadingScreen } from '@officexr/world/react';
import type { JoinCheck } from './useJoinCheck';
import { JoinPrompt } from './JoinPrompt';
import type { OfficeSession } from './useOfficeSession';

export function PreWorld(props: {
  title: string;
  join: JoinCheck;
  session: OfficeSession;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const { title, join, session, onJoin, onCancel } = props;
  return (
    <>
      {(session.type === 'connecting' || session.type === 'error') && (
        <WorldLoadingScreen
          title={title}
          step={join === 'checking' ? 'Checking your session…' : 'Connecting…'}
          error={session.type === 'error' ? session.message : undefined}
        />
      )}
      {join === 'prompt' && <JoinPrompt onJoin={onJoin} onCancel={onCancel} />}
    </>
  );
}
