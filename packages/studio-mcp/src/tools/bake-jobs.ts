import { randomUUID } from 'node:crypto';

export type BakeJobResult =
  | { action: 'pending' | 'skipped'; layoutName: string }
  | { action: 'baked'; layoutName: string; bytes: number }
  | { action: 'failed'; layoutName: string; error: string };

export type BakeAction = BakeJobResult['action'];

/** What `bake_map` found beyond per-layout results: maps that could not be checked and rooms that failed to load. */
export interface BakeJobPlan {
  results: BakeJobResult[];
  mapErrors: { map: string; error: string }[];
  missingRooms: { map: string; rooms: string[] }[];
}

export interface BakeJob extends BakeJobPlan {
  id: string;
  /** Set when the job finishes; a job without it is still running. */
  finishedAt?: number;
}

const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;

// ponytail: jobs live in this process's memory, so a studio restart loses them (and any in-flight bake).
export class BakeJobs {
  private readonly jobs = new Map<string, BakeJob>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  create(plan: BakeJobPlan): BakeJob {
    this.evictExpired();
    const job: BakeJob = { id: randomUUID(), ...plan };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): BakeJob | undefined {
    this.evictExpired();
    return this.jobs.get(id);
  }

  finish(job: BakeJob): void {
    job.finishedAt = this.now();
  }

  /** Lazy, so no timer keeps the process alive. */
  private evictExpired(): void {
    for (const [id, { finishedAt }] of this.jobs) {
      if (finishedAt !== undefined && this.now() - finishedAt >= FINISHED_JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }
}
