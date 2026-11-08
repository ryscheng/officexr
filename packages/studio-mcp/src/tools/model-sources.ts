import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type ModelSourceError, ModelSourceServiceError, type ModelSources } from '../model-sources.ts';
import { errorResult, guard, jsonResult } from './shared.ts';

const assertNever = (value: never): never => {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
};

const errorText = (error: ModelSourceError): string =>
  error.type === 'validation'
    ? `invalid request: ${error.message}`
    : error.type === 'busy'
      ? error.message
      : error.type === 'not_configured'
        ? `model sources are not configured: ${error.message}`
        : assertNever(error);

function serviceCall(work: () => Promise<unknown>): Promise<CallToolResult> {
  return guard(async () => {
    try {
      return jsonResult(await work());
    } catch (err) {
      if (err instanceof ModelSourceServiceError) {
        return errorResult(errorText(err.error));
      }
      throw err;
    }
  });
}

const packSchema = z.string().describe('Pack name: letters, digits, ".", "_" or "-", at most 64 characters.');

export function registerModelSourceTools(server: McpServer, modelSources: ModelSources): void {
  server.registerTool(
    'request_model_upload',
    {
      description:
        'Get signed PUT URLs to upload raw model files of a pack to private storage (at most 50 per call). ' +
        'Each path is pack-relative POSIX ([A-Za-z0-9._-] segments) ending .glb, .gltf, .bin, .png, .jpg, .jpeg or .webp; ' +
        'sha256 is the lowercase hex digest and sizeBytes the exact size (at most 100 MB). PUT each file to its url with ' +
        'exactly the returned headers before it expires. Re-uploading a path overwrites it. Then call finalize_model per entry.',
      inputSchema: {
        pack: packSchema,
        files: z.array(z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number() })),
      },
    },
    (args) => serviceCall(() => modelSources.requestUpload(args.pack, args.files)),
  );
  server.registerTool(
    'finalize_model',
    {
      description:
        'Turn an uploaded .glb or .gltf entry (with every buffer and image it references uploaded) into a catalog kind ' +
        '"<pack>/<entry without extension>" (rejected if another entry, e.g. x.glb vs x.gltf, owns that id): a simplified, compressed derivative is served as its model, and layout bakes ' +
        'read the raw upload. Re-finalizing updates the model and keeps the kind\'s other fields, including localAABB, ' +
        'dimensions and collider fields, which may then be stale if the geometry changed. Fails while a bake or render is ' +
        'running; retry shortly. A very large model can outlast the ~60 s request cap; the work still completes, so check ' +
        'list_model_sources before retrying.',
      inputSchema: { pack: packSchema, entry: z.string().describe('Pack-relative path of the .glb or .gltf.') },
    },
    (args) => serviceCall(() => modelSources.finalize(args.pack, args.entry)),
  );
  server.registerTool(
    'list_model_sources',
    {
      description:
        'List uploaded raw model files ({path, sizeBytes, updated}) grouped by pack, with the entries that have a catalog kind.',
      inputSchema: { pack: packSchema.optional() },
    },
    (args) => serviceCall(() => modelSources.list(args.pack)),
  );
}
