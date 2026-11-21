import { Blocked } from '../page/Blocked';

export function JoinPrompt({ onJoin }: { onJoin: () => void }) {
  return <Blocked surface="dim" variant="otherWindow" details="Session replaced" onPrimary={onJoin} />;
}
