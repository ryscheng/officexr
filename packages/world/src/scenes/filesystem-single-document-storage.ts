/**
 * Fetch client for a single-document middleware (GET → doc | 404, PUT → 2xx);
 * `load` is null until the document has been saved.
 */
export class FilesystemSingleDocumentStorage<T> {
  private base: string;

  constructor(
    basePath: string,
    private label: string,
    private validate: (raw: unknown) => T,
  ) {
    this.base = basePath.replace(/\/$/, '');
  }

  async load(): Promise<T | null> {
    const r = await fetch(this.base, { method: 'GET' });
    if (r.status === 404) {
      return null;
    }
    if (!r.ok) {
      throw new Error(`${this.label} load: ${r.status}`);
    }
    return this.validate(await r.json());
  }

  async save(doc: T): Promise<void> {
    const r = await fetch(this.base, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!r.ok) {
      await this.rejectSave(r);
    }
  }

  /** Always throws; subclasses map specific statuses to richer errors first. */
  protected async rejectSave(r: Response): Promise<never> {
    throw new Error(`${this.label} save: ${r.status}`);
  }
}
