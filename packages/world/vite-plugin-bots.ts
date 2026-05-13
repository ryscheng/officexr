import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as url from 'node:url';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI = path.resolve(HERE, 'src/bot/bots-cli.ts');
// Default port matches `bots-cli`'s `REALTIME_PORT` default. Probe via
// the `/health` endpoint exposed by `RealtimeServer`.
const DEFAULT_HEALTH = 'http://127.0.0.1:8787/health';
const PROBE_TIMEOUT_MS = 800;

export interface BotsPluginOptions {
  /**
   * Health endpoint to probe before spawning. If a request succeeds
   * (HTTP 2xx) the plugin assumes the user is already running
   * `pnpm bots:start` in another terminal and skips spawning.
   * Default: `http://127.0.0.1:8787/health`.
   */
  healthUrl?: string;
  /** Override the path to the CLI .ts file. */
  cliPath?: string;
  /**
   * Skip the plugin entirely. Useful when running studio against a
   * remote bot server, or when the developer prefers to manage the
   * CLI in a separate terminal. Default: `false`.
   */
  disabled?: boolean;
  /**
   * Environment variables passed to the spawned CLI. Merged on top of
   * the parent process env. Most useful keys: `REALTIME_PORT`,
   * `REALTIME_PATH`, `OFFICE_ID`, `BOT_COUNT`, `BOT_MODE`.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Vite dev plugin that runs `bots-cli` as a child process for the
 * lifetime of the dev server. Studio uses this so a single
 * `pnpm dev:studio` boots both the browser app and the Node bot
 * server — pushing the Leva bot count to ≥ 2 promotes the studio
 * stack to `ws` mode and the spawned CLI handles it without the
 * developer running anything in a second terminal.
 *
 * Behavior summary:
 *   - `apply: 'serve'` — never runs in `vite build`.
 *   - Probes `healthUrl` first; if the server is already up, skip
 *     spawning. Lets a manually-started CLI coexist.
 *   - Pipes stdout/stderr to the parent with a `[bots]` prefix so
 *     the dev console stays readable.
 *   - Kills the child on Vite dev-server close, parent SIGINT /
 *     SIGTERM, and parent exit.
 */
export default function botsPlugin(opts: BotsPluginOptions = {}): Plugin {
  const healthUrl = opts.healthUrl ?? DEFAULT_HEALTH;
  const cliPath = opts.cliPath ?? DEFAULT_CLI;
  let child: ChildProcess | null = null;
  let cleanupRegistered = false;

  return {
    name: 'officexr:bots',
    apply: 'serve',
    async configureServer(server: ViteDevServer) {
      if (opts.disabled) return;

      // Probe the health endpoint. If something already answers, we
      // assume the developer started the CLI manually and bow out.
      if (await probeHealthy(healthUrl)) {
        server.config.logger.info(
          `[officexr:bots] external bot server already running at ${healthUrl} — not spawning`,
        );
        return;
      }

      const tsxHooks = resolveTsxHooks();
      if (!tsxHooks) {
        server.config.logger.warn(
          '[officexr:bots] could not resolve `tsx`; install it as a workspace devDep or set vite-plugin-bots `disabled: true`',
        );
        return;
      }

      server.config.logger.info(
        `[officexr:bots] spawning bots-cli (${path.relative(process.cwd(), cliPath)})`,
      );

      // Invoke Node directly with tsx's loader hooks instead of going
      // through tsx's CLI launcher. The launcher is itself a Node
      // process that re-spawns Node with these same hooks and then
      // exits — which would make our `child.on('exit')` fire
      // immediately even though the real CLI is alive in a
      // grandchild. Running Node ourselves keeps a 1:1 relationship
      // between our `child` handle and the long-running process, so
      // exit tracking + signal forwarding work correctly.
      const nodeArgs = [
        '--require',
        tsxHooks.preflight,
        '--import',
        url.pathToFileURL(tsxHooks.loader).href,
        cliPath,
      ];
      child = spawn(process.execPath, nodeArgs, {
        cwd: path.dirname(cliPath),
        env: { ...process.env, FORCE_COLOR: '1', ...opts.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Prefix every line of child output so it's distinguishable from
      // Vite's own log stream. Buffer until newline so we don't split
      // ANSI escape sequences in the middle.
      pipePrefixed(child.stdout, '[bots] ', process.stdout);
      pipePrefixed(child.stderr, '[bots] ', process.stderr);

      child.on('exit', (code, signal) => {
        const wasRunning = child !== null;
        child = null;
        if (!wasRunning) return;
        const detail =
          signal !== null ? `signal=${signal}` : `code=${code ?? 'null'}`;
        if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
          server.config.logger.info(`[officexr:bots] bots-cli stopped (${detail})`);
        } else {
          server.config.logger.warn(
            `[officexr:bots] bots-cli exited unexpectedly (${detail})`,
          );
        }
      });

      // Tear down the child when the Vite dev server closes (e.g.
      // config edit triggers a restart). Vite calls this hook on
      // `server.close()`.
      const closeHandler = () => killChild('SIGTERM');
      server.httpServer?.once('close', closeHandler);

      if (!cleanupRegistered) {
        cleanupRegistered = true;
        // Belt-and-suspenders for Ctrl-C and process exit. The shell's
        // SIGINT broadcast usually reaches the child via the process
        // group, but explicit cleanup is safer when the child is in a
        // detached pipe.
        const onSignal = () => killChild('SIGTERM');
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
        process.once('exit', () => killChild('SIGKILL'));
      }
    },
  };

  function killChild(signal: NodeJS.Signals): void {
    const c = child;
    if (!c || c.killed) return;
    child = null;
    try {
      c.kill(signal);
    } catch {
      // Ignore — child may have already exited.
    }
  }
}

/**
 * Resolve the on-disk paths of tsx's loader hooks (preflight.cjs +
 * loader.mjs) from the installed `tsx` package. We pass these to
 * Node directly so we can run the CLI in a single Node process whose
 * exit truly means "the script finished" — see the spawn site for
 * why going through tsx's CLI launcher doesn't work for our use
 * case.
 */
function resolveTsxHooks(): { preflight: string; loader: string } | null {
  const req = createRequire(import.meta.url);
  let pkgJson: string;
  try {
    pkgJson = req.resolve('tsx/package.json');
  } catch {
    return null;
  }
  const tsxRoot = path.dirname(pkgJson);
  const preflight = path.join(tsxRoot, 'dist', 'preflight.cjs');
  const loader = path.join(tsxRoot, 'dist', 'loader.mjs');
  return { preflight, loader };
}

async function probeHealthy(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function pipePrefixed(
  stream: NodeJS.ReadableStream | null,
  prefix: string,
  out: NodeJS.WritableStream,
): void {
  if (!stream) return;
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffered += chunk;
    let idx: number;
    while ((idx = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 1);
      out.write(`${prefix}${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffered.length > 0) out.write(`${prefix}${buffered}\n`);
  });
}
