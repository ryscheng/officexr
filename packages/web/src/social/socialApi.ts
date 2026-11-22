import { NO_SOCIAL, type BlockedPerson, type ReportReason, type SocialCapabilities } from '@officexr/sdk';
import { apiFetch, paths } from '../apiOrigin';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function fetchCapabilities(): Promise<SocialCapabilities> {
  try {
    const res = await apiFetch(paths.social);
    if (!res.ok) {
      return NO_SOCIAL;
    }
    const body = (await res.json()) as Partial<Record<keyof SocialCapabilities, unknown>> | null;
    return {
      block: body?.block === true,
      report: body?.report === true,
      nearbyChat: body?.nearbyChat === true,
      directChat: body?.directChat === true,
    };
  } catch {
    return NO_SOCIAL;
  }
}

const parseBlocks = (body: unknown): BlockedPerson[] => {
  const list = (body as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(list)
    ? list.flatMap((item) => {
        const { login, name } = (item ?? {}) as Partial<BlockedPerson>;
        return typeof login === 'string' ? [{ login, name: typeof name === 'string' ? name : null }] : [];
      })
    : [];
};

export async function fetchBlocks(): Promise<BlockedPerson[] | null> {
  try {
    const res = await apiFetch(paths.blocks);
    return res.ok ? parseBlocks(await res.json()) : null;
  } catch {
    return null;
  }
}

export async function putBlock(login: string, name: string): Promise<BlockedPerson[] | null> {
  try {
    const res = await apiFetch(paths.block(login), { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
    return res.ok ? parseBlocks(await res.json()) : null;
  } catch {
    return null;
  }
}

export async function deleteBlock(login: string): Promise<BlockedPerson[] | null> {
  try {
    const res = await apiFetch(paths.block(login), { method: 'DELETE' });
    return res.ok ? parseBlocks(await res.json()) : null;
  } catch {
    return null;
  }
}

export type ReportOutcome = 'sent' | 'too-many' | 'failed';

export async function postReport(report: { officeId: string; login: string; reason: ReportReason; note: string }): Promise<ReportOutcome> {
  try {
    const res = await apiFetch(paths.reports, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ...report, note: report.note.trim() || undefined }) });
    return res.ok ? 'sent' : res.status === 429 ? 'too-many' : 'failed';
  } catch {
    return 'failed';
  }
}

