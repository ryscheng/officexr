import { useState } from 'react';
import { Button } from '../hud/ui/Button';
import { useSocial } from './SocialProvider';

export function BlockedPeople() {
  const { caps, blocked, unblock } = useSocial();
  const [failed, setFailed] = useState(false);
  if (!caps.block || blocked.length === 0) {
    return null;
  }
  return (
    <section aria-label="Blocked people" className="flex flex-col gap-1 px-2 pb-1">
      <h3 className="text-sm font-semibold text-hud-text-2">Blocked people · {blocked.length}</h3>
      <ul className="divide-y divide-hud-separator">
        {blocked.map((person) => {
          const label = person.name ?? person.login;
          return (
            <li key={person.login} className="flex min-h-14 items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate px-2 text-base text-hud-text">{label}</span>
              <Button
                className="min-h-12"
                aria-label={`Unblock ${label}`}
                onClick={async () => setFailed(!(await unblock(person.login)))}
              >
                Unblock
              </Button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-hud-rose-text">
          Could not unblock. Try again.
        </p>
      )}
    </section>
  );
}
