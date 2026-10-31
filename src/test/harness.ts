import { runCli } from '../main.ts';
import type { Deps } from '../main.ts';

export const BASE = 'https://mw.test/v1';
export const TOKEN = 'tok-SECRET-0123456789';

export type Req = { method: string; path: string; headers: Record<string, string>; body: unknown };
export type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; raw?: string };
export type Handler = (req: Req, n: number) => Reply | undefined;

export type Harness = {
  run: (...argv: string[]) => Promise<{ code: number; out: string; err: string }>;
  requests: Req[];
  sleeps: number[];
  audit: { path: string; data: string; opts: { flag: string; mode: number } }[];
  clock: { t: number };
  securityCalls: [string, string][];
};

export function harness(
  opts: { handler?: Handler; env?: Record<string, string | undefined>; files?: Record<string, string>; security?: (s: string, a: string) => string } = {},
): Harness {
  const requests: Req[] = [];
  const sleeps: number[] = [];
  const audit: { path: string; data: string; opts: { flag: string; mode: number } }[] = [];
  const securityCalls: [string, string][] = [];
  const clock = { t: Date.UTC(2026, 0, 1) };
  const env = opts.env ?? { MW_URL: BASE, MW_TOKEN: TOKEN };

  const fake: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const req: Req = {
      method: init?.method ?? 'GET',
      path: url.slice(BASE.length),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const reply = opts.handler?.(req, requests.length) ?? {};
    const status = reply.status ?? 200;
    const text = reply.raw ?? JSON.stringify(reply.body ?? {});
    return new Response(status === 204 ? null : text, { status, headers: reply.headers ?? {} });
  };

  return {
    requests,
    sleeps,
    audit,
    clock,
    securityCalls,
    run: async (...argv) => {
      let out = '';
      let err = '';
      const deps: Deps = {
        stdout: { write: (s) => (out += s) },
        stderr: { write: (s) => (err += s) },
        env,
        home: '/home/test',
        readFile: (p) => {
          const f = opts.files?.[p];
          if (f === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return f;
        },
        runSecurity: (s, a) => {
          securityCalls.push([s, a]);
          if (opts.security === undefined) throw new Error('security must not be called');
          return opts.security(s, a);
        },
        fetch: fake,
        now: () => clock.t,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock.t += ms;
        },
        appendFile: (path, data, opts) => {
          audit.push({ path, data, opts });
        },
      };
      const code = await runCli(argv, deps);
      return { code, out, err };
    },
  };
}
