import { randomUUID } from 'node:crypto';

export type BakeAction = 'baked' | 'skipped' | 'failed' | 'pending';

export interface BakeJobResult {
  layoutName: string;
  action: BakeAction;
  error?: string;
  bytes?: number;
}

export interface BakeJob {
  id: string;
  results: BakeJobResult[];
  /** Set when the job finishes; a job without it is still running. */
  finishedAt?: number;
}

const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;

// ponytail: jobs live in this process's memory, so a studio restart loses them (and any in-flight bake).
export class BakeJobs {
  private readonly jobs = new Map<string, BakeJob>();

  constructor(private readonly now: () => number = Date.now) {}

  create(results: BakeJobResult[]): BakeJob {
    this.evictExpired();
    const job: BakeJob = { id: randomUUID(), results };
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
