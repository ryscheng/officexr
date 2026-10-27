/**
 * Lets one memory-hungry operation (a bake, a browser render) run at a time. It rejects rather than
 * queues: a queued call would outlive the ~60 s upstream cap and the agent can simply retry.
 */
export class HeavyWorkLock {
  private busy = false;

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new Error('a bake or render is already in progress; retry shortly');
    }
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
}
