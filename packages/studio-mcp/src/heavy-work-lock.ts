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

  /** Takes the lock now or throws; the returned function releases it. */
  acquire(): () => void {
    if (this.busy) {
      throw new Error(`${this.work} is already in progress; retry shortly`);
    }
    this.busy = true;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.busy = false;
      }
    };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}
