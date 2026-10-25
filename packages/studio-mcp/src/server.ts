import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { StudioDocuments } from './studio-documents.ts';
import { registerBakedLayoutTools, type BakeLock } from './tools/baked-layouts.ts';
import { registerLayoutTools } from './tools/layouts.ts';
import { registerMapTools } from './tools/maps.ts';
import { registerRoomTools } from './tools/rooms.ts';
import { registerWorldTools } from './tools/world.ts';

export interface StudioMcpOptions {
  /** Directory the catalog's `/models/...` paths resolve against when baking. */
  modelRoot: string;
  /** Shared across requests: each request builds a fresh server, and a bake peaks near 290 MB. */
  bakeLock: BakeLock;
}

export function createStudioMcpServer(docs: StudioDocuments, { modelRoot, bakeLock }: StudioMcpOptions): McpServer {
  const server = new McpServer({ name: 'officexr-studio', version: '0.1.0' });
  registerRoomTools(server, docs);
  registerMapTools(server, docs);
  registerLayoutTools(server, docs);
  registerBakedLayoutTools(server, docs, modelRoot, bakeLock);
  registerWorldTools(server, docs);
  return server;
}

/** Serves one stateless JSON-response MCP request on a fresh server. */
export async function handleMcpRequest(
  docs: StudioDocuments,
  options: StudioMcpOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const server = createStudioMcpServer(docs, options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
