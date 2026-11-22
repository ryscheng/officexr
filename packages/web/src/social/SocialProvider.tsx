import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NO_SOCIAL, type BlockedPerson, type PlayerId, type ReportReason, type SocialCapabilities } from '@officexr/sdk';
import { deleteBlock, fetchBlocks, fetchCapabilities, postReport, putBlock, type ReportOutcome } from './socialApi';

export interface DirectRequest {
  id: PlayerId;
  count: number;
}

export interface Social {
  officeId: string;
  officeName: string;
  caps: SocialCapabilities;
  blocked: BlockedPerson[];
  block: (login: string, name: string) => Promise<boolean>;
  unblock: (login: string) => Promise<boolean>;
  report: (login: string, reason: ReportReason, note: string) => Promise<ReportOutcome>;
  directRequest: DirectRequest | null;
  messagePerson: (id: PlayerId) => void;
}

const NONE: Social = {
  officeId: '',
  officeName: '',
  caps: NO_SOCIAL,
  blocked: [],
  block: async () => false,
  unblock: async () => false,
  report: async () => 'failed',
  directRequest: null,
  messagePerson: () => undefined,
};

const SocialContext = createContext<Social>(NONE);

export const useSocial = (): Social => useContext(SocialContext);

export function SocialProvider({ officeId, officeName, children }: { officeId: string; officeName: string; children: ReactNode }) {
  const [caps, setCaps] = useState<SocialCapabilities>(NO_SOCIAL);
  const [blocked, setBlocked] = useState<BlockedPerson[]>([]);
  const [directRequest, setDirectRequest] = useState<DirectRequest | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchCapabilities().then((found) => {
      if (!cancelled) {
        setCaps(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!caps.block) {
      return;
    }
    let cancelled = false;
    void fetchBlocks().then((list) => {
      if (!cancelled && list) {
        setBlocked(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [caps.block]);
  const block = useCallback(async (login: string, name: string) => {
    const list = await putBlock(login, name);
    if (list) {
      setBlocked(list);
    }
    return list !== null;
  }, []);
  const unblock = useCallback(async (login: string) => {
    const list = await deleteBlock(login);
    if (list) {
      setBlocked(list);
    }
    return list !== null;
  }, []);
  const report = useCallback((login: string, reason: ReportReason, note: string) => postReport({ officeId, login, reason, note }), [officeId]);
  const messagePerson = useCallback((id: PlayerId) => setDirectRequest((prev) => ({ id, count: (prev?.count ?? 0) + 1 })), []);
  const value = useMemo<Social>(
    () => ({ officeId, officeName, caps, blocked, block, unblock, report, directRequest, messagePerson }),
    [officeId, officeName, caps, blocked, block, unblock, report, directRequest, messagePerson],
  );
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}
