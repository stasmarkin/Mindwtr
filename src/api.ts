import { ApiError, AuthError } from './errors.ts';

export type ApiDeps = {
  baseUrl: string;
  token: string;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
};

export type ApiResponse = { status: number; headers: Headers; text: string; data: unknown };

const BUCKET_CAPACITY = 100;
const BUCKET_REFILL_PER_MIN = 100;
const DEFAULT_RETRY_AFTER_MS = 2000;
const MAX_RETRY_AFTER_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
export const PAGE_SIZE = 1000;

// Client-side limiter that stays below the server's 120 requests/min.
export class TokenBucket {
  private tokens = BUCKET_CAPACITY;
  private last: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(now: () => number, sleep: (ms: number) => Promise<void>) {
    this.now = now;
    this.sleep = sleep;
    this.last = now();
  }

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(BUCKET_CAPACITY, this.tokens + ((t - this.last) * BUCKET_REFILL_PER_MIN) / 60_000);
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) * 60_000) / BUCKET_REFILL_PER_MIN));
    }
  }
}

export function retryAfterMs(header: string | null): number {
  if (header === null || !/^\d+(\.\d+)?$/.test(header.trim())) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(Number(header) * 1000, MAX_RETRY_AFTER_MS);
}

export class Api {
  private readonly deps: ApiDeps;
  private readonly bucket: TokenBucket;

  constructor(deps: ApiDeps) {
    this.deps = deps;
    this.bucket = new TokenBucket(deps.now, deps.sleep);
  }

  get(path: string, query?: RequestOptions['query']): Promise<ApiResponse> {
    return this.request('GET', path, query === undefined ? {} : { query });
  }

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResponse> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) params.set(k, String(v));
    const qs = params.size > 0 ? `?${params}` : '';
    const label = `${path}${qs}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.deps.token}`, Accept: 'application/json', ...opts.headers };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    for (let attempt = 0; ; attempt++) {
      await this.bucket.take();
      let res: Response;
      let text: string;
      try {
        res = await this.deps.fetch(`${this.deps.baseUrl}${label}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        text = await res.text();
      } catch (e) {
        throw new ApiError(method, label, 0, describeFailure(e));
      }
      if (res.status === 429 && attempt === 0) {
        await this.deps.sleep(retryAfterMs(res.headers.get('retry-after')));
        continue;
      }
      if (res.status === 401) throw new AuthError(`${method} ${label} -> 401: token rejected by the server\n${text}`);
      if (!res.ok) throw new ApiError(method, label, res.status, text);
      let data: unknown;
      try {
        data = text === '' ? undefined : JSON.parse(text);
      } catch {
        data = undefined;
      }
      return { status: res.status, headers: res.headers, text, data };
    }
  }
}

function describeFailure(e: unknown): string {
  if (e instanceof Error && e.name === 'TimeoutError') return `timeout after ${REQUEST_TIMEOUT_MS / 1000}s`;
  if (!(e instanceof Error)) return String(e);
  // undici reports the real reason (ECONNREFUSED, ENOTFOUND...) only in `cause`.
  const cause = e.cause instanceof Error ? e.cause.message : undefined;
  return cause === undefined ? e.message : `${e.message} (${cause})`;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Pulls `{ key: [...] }` out of a list response; anything else is a server-contract violation reported as an API error.
export function listFrom(res: ApiResponse, key: string, method: string, path: string): Record<string, unknown>[] {
  const v = isRecord(res.data) ? res.data[key] : undefined;
  if (!Array.isArray(v)) throw new ApiError(method, path, res.status, `unexpected response, expected {"${key}": [...]}:\n${res.text}`);
  return v.filter(isRecord);
}

export function objectFrom(res: ApiResponse, key: string, method: string, path: string): Record<string, unknown> {
  const v = isRecord(res.data) ? res.data[key] : undefined;
  if (!isRecord(v)) throw new ApiError(method, path, res.status, `unexpected response, expected {"${key}": {...}}:\n${res.text}`);
  return v;
}

// A missing key is an empty list; for fields the server may legitimately omit.
export function optionalListFrom(res: ApiResponse, key: string): Record<string, unknown>[] {
  const v = isRecord(res.data) ? res.data[key] : undefined;
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

// Pages until a short page, so callers can reason about the whole set instead of the first 1000 items.
export async function listAll(api: Api, path: string, key: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let prevFirstId: unknown;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await api.get(path, { ...query, limit: PAGE_SIZE, offset });
    const page = listFrom(res, key, 'GET', path);
    // An endpoint that ignores offset would repeat page 1 forever.
    if (offset > 0 && page[0] !== undefined && page[0]['id'] === prevFirstId) {
      throw new ApiError('GET', path, 0, `server ignored offset=${offset}; refusing to loop`);
    }
    prevFirstId = page[0]?.['id'];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}
