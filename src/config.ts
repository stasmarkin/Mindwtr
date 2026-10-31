import { ConfigError } from './errors.ts';

export type ResolvedConfig = {
  url: string;
  token: string;
  // Human-readable origin of the token; never the token itself.
  tokenSource: string;
};

export type ConfigDeps = {
  env: Record<string, string | undefined>;
  // Returns file contents; throws an errno-style error (code 'ENOENT') when missing.
  readFile: (path: string) => string;
  // Returns the secret stored in the macOS Keychain; throws when it cannot be read.
  runSecurity: (service: string, account: string) => string;
  home: string;
};

type FileConfig = { url?: string; token?: string; keychain?: { service: string; account: string } };

const KEYS = new Set(['url', 'token', 'keychain']);

export const KEYCHAIN_HINT =
  'set MW_TOKEN, or put "token" or "keychain": {"service": "...", "account": "..."} into the config file';

export function configPath(env: ConfigDeps['env'], home: string): string {
  return nonEmpty(env.MW_CONFIG) ?? `${home}/.config/mw/config.json`;
}

export function loadConfig(deps: ConfigDeps): ResolvedConfig {
  const { env } = deps;
  const explicit = nonEmpty(env.MW_CONFIG);
  const file = configPath(env, deps.home);
  const cfg = readFileConfig(deps, file, explicit !== undefined);

  const url = (nonEmpty(env.MW_URL) ?? cfg.url)?.replace(/\/+$/, '');
  if (url === undefined) {
    throw new ConfigError(`no API URL: set MW_URL or "url" in ${file} (for example https://mindwtr.example.com/v1)`);
  }
  assertUrl(url);

  const envToken = nonEmpty(env.MW_TOKEN);
  if (envToken !== undefined) return { url, token: envToken, tokenSource: 'env MW_TOKEN' };
  if (cfg.token !== undefined) return { url, token: cfg.token, tokenSource: 'config file' };
  if (cfg.keychain !== undefined) {
    const { service, account } = cfg.keychain;
    let token: string;
    try {
      token = deps.runSecurity(service, account).trim();
    } catch {
      throw new ConfigError(`cannot read the token from Keychain item ${service}/${account}`);
    }
    if (token === '') throw new ConfigError(`Keychain item ${service}/${account} is empty`);
    return { url, token, tokenSource: `keychain ${service}/${account}` };
  }
  throw new ConfigError(`no token: ${KEYCHAIN_HINT}`);
}

// Host only: the path of a self-hosted URL can be semi-private, and the token is never shown.
export function displayUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/…`;
}

function nonEmpty(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

function assertUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ConfigError('API URL is not a valid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ConfigError('API URL must start with http:// or https://');
}

function readFileConfig(deps: ConfigDeps, file: string, mustExist: boolean): FileConfig {
  let text: string;
  try {
    text = deps.readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      if (mustExist) throw new ConfigError(`config file ${file} not found`);
      return {};
    }
    throw new ConfigError(`cannot read config file ${file}: ${(e as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`config ${file}: invalid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ConfigError(`config ${file}: expected a JSON object`);
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.has(k)) throw new ConfigError(`config ${file}: unknown key "${k}"`);
  const out: FileConfig = {};
  if (o.url !== undefined) out.url = str(file, 'url', o.url);
  if (o.token !== undefined) out.token = str(file, 'token', o.token);
  if (o.keychain !== undefined) {
    const k = o.keychain;
    if (typeof k !== 'object' || k === null || Array.isArray(k)) throw new ConfigError(`config ${file}: keychain: expected {"service", "account"}`);
    const kk = k as Record<string, unknown>;
    out.keychain = { service: str(file, 'keychain.service', kk.service), account: str(file, 'keychain.account', kk.account) };
  }
  return out;
}

function str(file: string, key: string, v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw new ConfigError(`config ${file}: ${key}: expected a non-empty string`);
  return v.trim();
}
