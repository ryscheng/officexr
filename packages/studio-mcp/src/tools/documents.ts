import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isValidSceneName, type SceneSummary } from '@officexr/world/scenes';
import { z } from 'zod';
import { documentSchema, errorResult, guard, jsonResult } from './shared.ts';

export interface DocumentStore<T> {
  list(): Promise<SceneSummary[]>;
  load(name: string): Promise<T | null>;
  save(name: string, doc: T): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface DocumentToolSpec {
  /** Singular, snake_case: becomes `get_<noun>` and the argument key of `put_<noun>`. */
  noun: string;
  /** What the document is and its coordinate conventions. */
  description: string;
  /** Runs before the write; throw to reject. */
  beforeSave?: (doc: unknown) => Promise<void>;
}

const nameSchema = z.string().describe('Document name: letters, digits, ".", "_" or "-", at most 64 characters.');

function checkedName(name: string): string {
  if (!isValidSceneName(name)) {
    throw new Error(`invalid name "${name}": use letters, digits, ".", "_" or "-", at most 64 characters`);
  }
  return name;
}

/** Registers `list_<noun>s`, `get_<noun>`, `put_<noun>` and `delete_<noun>`. */
export function registerDocumentTools<T>(
  server: McpServer,
  store: DocumentStore<T>,
  { noun, description, beforeSave }: DocumentToolSpec,
): void {
  const template = `Call get_${noun} on an existing ${noun} to use as a template before writing one.`;

  server.registerTool(
    `list_${noun}s`,
    { description: `List the studio's ${noun}s (name, title, updatedAt). ${description}` },
    () => guard(async () => jsonResult(await store.list())),
  );
  server.registerTool(
    `get_${noun}`,
    { description: `Read one ${noun} by name. ${description}`, inputSchema: { name: nameSchema } },
    ({ name }) =>
      guard(async () => {
        const doc = await store.load(checkedName(name));
        return doc ? jsonResult(doc) : errorResult(`${noun} "${name}" not found`);
      }),
  );
  server.registerTool(
    `put_${noun}`,
    {
      description: `Create or replace a ${noun}; it is validated and nothing is written if invalid. ${description} ${template}`,
      inputSchema: { name: nameSchema, [noun]: documentSchema },
    },
    (args) =>
      guard(async () => {
        const name = checkedName(args.name);
        const doc = args[noun];
        await beforeSave?.(doc);
        await store.save(name, doc as T);
        return jsonResult({ saved: name });
      }),
  );
  server.registerTool(
    `delete_${noun}`,
    { description: `Delete a ${noun} by name; deleting a missing one is not an error.`, inputSchema: { name: nameSchema } },
    ({ name }) =>
      guard(async () => {
        await store.delete(checkedName(name));
        return jsonResult({ deleted: name });
      }),
  );
}
