/** Binary min-heap of integer ids keyed by priority. Duplicate ids are allowed. */
export class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    let k = this.ids.length;
    this.ids.push(id);
    this.keys.push(key);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (this.keys[parent] <= key) {
        break;
      }
      this.move(parent, k);
      k = parent;
    }
    this.ids[k] = id;
    this.keys[k] = key;
  }

  /** Removes and returns the id with the smallest key; the heap must not be empty. */
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    const n = this.ids.length;
    if (n === 0) {
      return top;
    }
    let k = 0;
    for (;;) {
      let child = 2 * k + 1;
      if (child >= n) {
        break;
      }
      if (child + 1 < n && this.keys[child + 1] < this.keys[child]) {
        child++;
      }
      if (this.keys[child] >= lastKey) {
        break;
      }
      this.move(child, k);
      k = child;
    }
    this.ids[k] = lastId;
    this.keys[k] = lastKey;
    return top;
  }

  private move(from: number, to: number): void {
    this.ids[to] = this.ids[from];
    this.keys[to] = this.keys[from];
  }
}
