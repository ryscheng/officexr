import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextHandleFunction } from 'connect';
import express from 'express';
import { ModelSourceServiceError, type ModelSourceError, type ModelSources, type UploadFile } from '@officexr/studio-mcp/model-sources';
import { assertNever } from '../http.ts';
import { sendJson } from '../studio-gate.ts';

const statusOf = (error: ModelSourceError): number =>
  error.type === 'validation' ? 400 : error.type === 'busy' ? 409 : error.type === 'not_configured' ? 503 : assertNever(error);

const parseJson = express.json({ limit: '256kb' });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isUploadFile = (value: unknown): value is UploadFile =>
  isRecord(value) && typeof value.path === 'string' && typeof value.sha256 === 'string' && typeof value.sizeBytes === 'number';

/** The JSON object body, or `null` once a 4xx has been sent for a missing, malformed or oversized one. */
function readBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    parseJson(req as express.Request, res as express.Response, (err?: unknown) => {
      const body: unknown = (req as express.Request).body;
      const status = (err as { status?: unknown } | undefined)?.status;
      if (err && !(typeof status === 'number' && status >= 400 && status < 500)) {
        reject(err);
      } else if (!err && isRecord(body)) {
        resolve(body);
      } else {
        sendJson(res, typeof status === 'number' ? status : 400, { error: 'Body must be a JSON object' });
        resolve(null);
      }
    });
  });
}

/**
 * Mount at `/api/model-sources`, after the gate. With a `null` service every route answers 503. Unexpected errors
 * go to `next`, so the server's error handler answers 500 without their details.
 */
export function modelSourceRoutes(service: ModelSources | null): NextHandleFunction {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    if (route !== 'POST /upload-url' && route !== 'POST /finalize' && route !== 'GET /') {
      return false;
    }
    if (!service) {
      sendJson(res, 503, { error: 'Model sources are not configured' });
      return true;
    }
    try {
      if (route === 'GET /') {
        sendJson(res, 200, await service.list(url.searchParams.get('pack') ?? undefined));
        return true;
      }
      const body = await readBody(req, res);
      if (!body) {
        return true;
      }
      if (typeof body.pack !== 'string') {
        sendJson(res, 400, { error: 'pack must be a string' });
      } else if (route === 'POST /finalize') {
        if (typeof body.entry === 'string') {
          sendJson(res, 200, await service.finalize(body.pack, body.entry));
        } else {
          sendJson(res, 400, { error: 'entry must be a string' });
        }
      } else if (Array.isArray(body.files) && body.files.every(isUploadFile)) {
        sendJson(res, 200, await service.requestUpload(body.pack, body.files));
      } else {
        sendJson(res, 400, { error: 'files must be an array of { path, sha256, sizeBytes }' });
      }
    } catch (err) {
      if (!(err instanceof ModelSourceServiceError)) {
        throw err;
      }
      sendJson(res, statusOf(err.error), { error: err.error.message });
    }
    return true;
  };
  return (req, res, next) => {
    handle(req, res).then((handled) => {
      if (!handled) {
        next();
      }
    }, next);
  };
}
