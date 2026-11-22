import { MAX_BLOCKS, type BlockedPerson, type ReportReason } from '@officexr/sdk';

export interface BlocksStore {
  list: (blocker: string) => Promise<BlockedPerson[]>;
  add: (blocker: string, blocked: string, name: string | null) => Promise<'ok' | 'limit'>;
  remove: (blocker: string, blocked: string) => Promise<void>;
}

export interface NewReport {
  officeId: string | null;
  reporter: string;
  reported: string;
  reason: ReportReason;
  note: string | null;
}

export interface ReportsStore {
  add: (report: NewReport) => Promise<void>;
}

export function createMemoryBlocks(): BlocksStore {
  const rows = new Map<string, Map<string, string | null>>();
  return {
    list: async (blocker) => [...(rows.get(blocker) ?? [])].map(([login, name]) => ({ login, name })),
    add: async (blocker, blocked, name) => {
      const mine = rows.get(blocker) ?? new Map<string, string | null>();
      if (!mine.has(blocked) && mine.size >= MAX_BLOCKS) {
        return 'limit';
      }
      mine.set(blocked, name);
      rows.set(blocker, mine);
      return 'ok';
    },
    remove: async (blocker, blocked) => {
      rows.get(blocker)?.delete(blocked);
    },
  };
}

export function createMemoryReports(): ReportsStore & { all: NewReport[] } {
  const all: NewReport[] = [];
  return {
    all,
    add: async (report) => {
      all.push(report);
    },
  };
}
