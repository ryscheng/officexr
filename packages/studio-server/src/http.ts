import type { IncomingMessage } from 'node:http';

export const pathname = (req: IncomingMessage) => req.url?.split('?')[0];
