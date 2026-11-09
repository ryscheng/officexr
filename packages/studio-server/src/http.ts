import type { IncomingMessage } from 'node:http';

export const pathname = (req: IncomingMessage) => req.url?.split('?')[0];

export const assertNever = (value: never): never => {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
};
