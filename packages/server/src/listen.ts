import type { Server } from 'node:http';

export const listen = (server: Server, port: number) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });

export const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
