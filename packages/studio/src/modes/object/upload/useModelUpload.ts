import { useCallback, useRef, useState } from 'react';
import type { WorldObjectKind } from '@officexr/world';
import type { ModelSourcesClient } from './modelSourcesClient.ts';
import { runModelUpload, type FileState, type PackFile } from './runModelUpload.ts';

export interface FileEntry extends PackFile {
  state: FileState;
}

export interface UseModelUploadOptions {
  client: ModelSourcesClient;
  onFinalized: (kind: WorldObjectKind) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface UseModelUploadResult {
  files: FileEntry[];
  running: boolean;
  /** True while a finalize is waiting out a 409. */
  busy: boolean;
  start: (pack: string, files: PackFile[]) => Promise<void>;
  /** Clears the last run's results; ignored while a run is in progress. */
  reset: () => void;
}

/** React adapter over `runModelUpload`: per-file state plus a single-run guard. */
export function useModelUpload({ client, onFinalized, sleep }: UseModelUploadOptions): UseModelUploadResult {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [running, setRunning] = useState(false);
  // `running` state lags a render, so a double click could otherwise start two runs.
  const runningRef = useRef(false);

  const start = useCallback(
    async (pack: string, picked: PackFile[]) => {
      if (runningRef.current) {
        return;
      }
      runningRef.current = true;
      setRunning(true);
      setFiles(picked.map((p) => ({ ...p, state: { type: 'pending' } })));
      try {
        await runModelUpload(client, pack, picked, {
          onFinalized,
          sleep,
          onState: (path, state) =>
            setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, state } : f))),
        });
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [client, onFinalized, sleep],
  );

  const reset = useCallback(() => {
    if (!runningRef.current) {
      setFiles([]);
    }
  }, []);

  const busy = files.some((f) => f.state.type === 'finalizing' && f.state.busy);
  return { files, running, busy, start, reset };
}
