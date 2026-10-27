/**
 * Lets one memory-hungry operation (a bake, a browser render) run at a time. It rejects rather than
 * queues: a queued call would outlive the ~60 s upstream cap and the agent can simply retry.
 */
export class HeavyWorkLock {
  private busy = false;
  private readonly work: string;

  /** `work` names what the lock guards in the busy message, e.g. "a bake or render". */
  constructor(work: string) {
    this.work = work;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new Error(`${this.work} is already in progress; retry shortly`);
    }
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
}
