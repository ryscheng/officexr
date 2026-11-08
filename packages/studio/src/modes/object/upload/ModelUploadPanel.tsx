import React, { useMemo, useState } from 'react';
import type { WorldObjectKind } from '@officexr/world';
import { isValidSceneName } from '@officexr/world/scenes';
import { Button } from '../../../components/ui/button.tsx';
import { assertNever } from '../../../assertNever.ts';
import { Field } from '../../../ui/controls/index.ts';
import { useTestStorages } from '../../../test-harness/TestStorageContext.tsx';
import { createModelSourcesClient } from './modelSourcesClient.ts';
import { toPackFiles, type FileState, type PackFile } from './runModelUpload.ts';
import { useModelUpload } from './useModelUpload.ts';

const statusLabel = (state: FileState): string =>
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

const inputClass = 'h-7 w-full rounded-sm border border-input bg-secondary px-2';

interface ModelUploadPanelProps {
  id: string;
  hidden: boolean;
  onFinalized: (kind: WorldObjectKind) => void;
}

/** Stays mounted while hidden so a running upload and its results survive closing the panel. */
export function ModelUploadPanel({ id, hidden, onFinalized }: ModelUploadPanelProps) {
  const injected = useTestStorages()?.modelSourcesClient;
  const client = useMemo(() => injected ?? createModelSourcesClient(), [injected]);
  const upload = useModelUpload({ client, onFinalized });
  const [pack, setPack] = useState('');
  const [picked, setPicked] = useState<PackFile[]>([]);

  const packName = pack.trim();
  const packValid = isValidSceneName(packName);
  const pick = (files: FileList | null) => {
    upload.reset();
    setPicked(toPackFiles(Array.from(files ?? [])));
  };
  const rows = upload.files.length
    ? upload.files
    : picked.map((p) => ({ ...p, state: { type: 'pending' } as FileState }));

  return (
    <section
      id={id}
      role="region"
      aria-label="Upload models"
      className={`${hidden ? 'hidden' : 'flex'} max-h-[70vh] w-80 flex-col gap-2 overflow-y-auto rounded-sm border border-input bg-background p-3 text-xs text-foreground`}
    >
      <Field label="Pack name" layout="stacked" htmlFor={`${id}-pack`}>
        <input
          id={`${id}-pack`}
          className={inputClass}
          value={pack}
          aria-invalid={packName !== '' && !packValid}
          onChange={(e) => setPack(e.target.value)}
        />
        {packName !== '' && !packValid && (
          <div role="alert" className="text-destructive">
            Use letters, digits, ".", "_" or "-", at most 64 characters.
          </div>
        )}
      </Field>
      <Field label="Folder" layout="stacked" htmlFor={`${id}-folder`}>
        <input
          id={`${id}-folder`}
          type="file"
          // @ts-expect-error webkitdirectory is not in React's input typings
          webkitdirectory=""
          disabled={upload.running}
          onChange={(e) => pick(e.target.files)}
        />
      </Field>
      <Field label="Files" layout="stacked" htmlFor={`${id}-files`}>
        <input
          id={`${id}-files`}
          type="file"
          multiple
          disabled={upload.running}
          onChange={(e) => pick(e.target.files)}
        />
      </Field>
      <Button
        size="sm"
        disabled={upload.running || !packValid || picked.length === 0}
        onClick={() => void upload.start(packName, picked)}
      >
        {upload.running ? 'Uploading…' : `Upload ${picked.length} file${picked.length === 1 ? '' : 's'}`}
      </Button>
      {upload.busy && <div role="status">Studio busy, waiting to finalize…</div>}
      <ul className="flex flex-col gap-1" aria-label="Upload progress" aria-live="polite">
        {rows.map((row) => (
          <li key={row.path} data-testid="upload-row" data-path={row.path} className="break-all">
            {row.path}: {statusLabel(row.state)}
          </li>
        ))}
      </ul>
    </section>
  );
}
