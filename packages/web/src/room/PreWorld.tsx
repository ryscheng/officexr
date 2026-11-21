import { Blocked } from '../page/Blocked';
import { EnteringOffice } from './EnteringOffice';
import type { JoinCheck } from './useJoinCheck';
import { JoinPrompt } from './JoinPrompt';
import type { OfficeSession } from './useOfficeSession';

export function PreWorld(props: {
  title: string;
  join: JoinCheck;
  session: OfficeSession;
  onJoin: () => void;
  onRetry: () => void;
}) {
  const { title, join, session, onJoin, onRetry } = props;
  return (
    <>
      {session.type === 'connecting' && <EnteringOffice stage={3} name={title} />}
      {session.type === 'error' && (
        <Blocked
          surface="cover"
          variant={navigator.onLine ? 'cannotConnect' : 'offline'}
          details={session.message}
          onPrimary={onRetry}
        />
      )}
      {session.type === 'replaced' && <Blocked surface="dim" variant="otherWindow" details="Session replaced" onPrimary={onRetry} />}
      {join === 'prompt' && <JoinPrompt onJoin={onJoin} />}
    </>
  );
}
