import React, { useMemo, useState } from 'react';
import type { WorldObjectKind } from '@officexr/world';
import { Button } from '../../../components/ui/button.tsx';
import { assertNever } from '../../../assertNever.ts';
import { useTestStorages } from '../../../test-harness/TestStorageContext.tsx';
import { createModelSourcesClient } from './modelSourcesClient.ts';
import { toPackFiles, useModelUpload, type FileState, type PackFile } from './useModelUpload.ts';

const describe = (state: FileState): string =>
  state.type === 'pending'
    ? 'pending'
    : state.type === 'hashing'
      ? 'hashing'
      : state.type === 'uploading'
        ? 'uploading'
        : state.type === 'uploaded'
          ? 'uploaded'
          : state.type === 'finalizing'
            ? state.busy
              ? 'studio busy, retrying'
              : 'finalizing'
            : state.type === 'done'
              ? `done: ${state.kindId}`
              : state.type === 'failed'
                ? `failed: ${state.error}`
                : assertNever(state);

export function ModelUploadPanel({
  onFinalized,
}: {
  onFinalized: (kinds: WorldObjectKind[]) => void;
}) {
  const injected = useTestStorages()?.modelSourcesClient;
  const client = useMemo(() => injected ?? createModelSourcesClient(), [injected]);
  const upload = useModelUpload({ client, onFinalized });
  const [pack, setPack] = useState('');
  const [picked, setPicked] = useState<PackFile[]>([]);

  // Show upload progress once a run has started; before that, the picked selection.
  const rows = upload.files.length ? upload.files : picked.map((p) => ({ ...p, state: { type: 'pending' } as FileState }));

  return (
    <div
      className="flex max-h-[70vh] w-80 flex-col gap-2 overflow-y-auto rounded-sm border border-input bg-background p-3 text-xs text-foreground"
      role="dialog"
      aria-label="Upload models"
    >
      <label className="flex flex-col gap-1">
        Pack name
        <input
          className="h-7 rounded-sm border border-input bg-secondary px-2"
          value={pack}
          onChange={(e) => setPack(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        Folder
        <input
          type="file"
          aria-label="Pick folder"
          // @ts-expect-error webkitdirectory is not in React's input typings
          webkitdirectory=""
          onChange={(e) => setPicked(toPackFiles(Array.from(e.target.files ?? [])))}
        />
      </label>
      <label className="flex flex-col gap-1">
        Files
        <input
          type="file"
          aria-label="Pick files"
          multiple
          onChange={(e) => setPicked(toPackFiles(Array.from(e.target.files ?? [])))}
        />
      </label>
      <Button
        size="sm"
        disabled={upload.running || !pack.trim() || picked.length === 0}
        onClick={() => void upload.start(pack.trim(), picked)}
      >
        {upload.running ? 'Uploading…' : `Upload ${picked.length} file${picked.length === 1 ? '' : 's'}`}
      </Button>
      {upload.busy && <div role="status">Studio busy, waiting to finalize…</div>}
      <ul className="flex flex-col gap-1" aria-label="Upload progress">
        {rows.map((row) => (
          <li key={row.path} data-testid="upload-row" data-path={row.path} className="break-all">
            {row.path}: {describe(row.state)}
          </li>
        ))}
      </ul>
    </div>
  );
}
