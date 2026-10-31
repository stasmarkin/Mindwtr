// Exit code 1: bad command line or bad reference (unknown area name, ambiguous id prefix).
export class UsageError extends Error {
  override name = 'UsageError';
}

// Exit code 2: the API answered with a non-2xx status or the request never completed (status 0).
export class ApiError extends Error {
  override name = 'ApiError';
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} -> ${status === 0 ? 'network error' : status}\n${body}`);
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

// Exit code 3: missing or unusable configuration.
export class ConfigError extends Error {
  override name = 'ConfigError';
}

// Exit code 3: the server rejected the token (HTTP 401).
export class AuthError extends Error {
  override name = 'AuthError';
}

export function exitCodeFor(e: unknown): number {
  if (e instanceof ApiError) return 2;
  if (e instanceof ConfigError || e instanceof AuthError) return 3;
  return 1;
}
