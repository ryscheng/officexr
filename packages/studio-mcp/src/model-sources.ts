import type { WorldObjectKind } from '@officexr/world/scenes';

export interface UploadFile {
  /** Pack-relative POSIX path. */
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface SignedUpload {
  path: string;
  url: string;
  method: 'PUT';
  /** Exactly the headers the PUT must send; the signature binds them. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ModelSourceFile {
  path: string;
  sizeBytes: number;
  updated: string;
}

export interface ModelSourcePack {
  pack: string;
  files: ModelSourceFile[];
  /** Paths of the entries a catalog kind's `sourceObject` points at. */
  finalizedEntries: string[];
}

export type ModelSourceError =
  | { type: 'validation'; message: string }
  | { type: 'busy'; message: string }
  | { type: 'not_configured'; message: string };

export class ModelSourceServiceError extends Error {
  constructor(readonly error: ModelSourceError) {
    super(error.message);
    this.name = 'ModelSourceServiceError';
  }
}

/** Private raw model packs and the served derivatives built from them. Failures throw `ModelSourceServiceError`. */
export interface ModelSources {
  requestUpload(pack: string, files: UploadFile[]): Promise<{ uploads: SignedUpload[] }>;
  /** Builds the served derivative of `entry` and upserts its catalog kind. */
  finalize(pack: string, entry: string): Promise<{ kind: WorldObjectKind }>;
  list(pack?: string): Promise<{ packs: ModelSourcePack[] }>;
}
