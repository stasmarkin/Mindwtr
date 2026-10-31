import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayUrl, loadConfig } from './config.ts';
import type { ConfigDeps } from './config.ts';
import { ConfigError } from './errors.ts';
import { BASE, harness, TOKEN } from './test/harness.ts';

const DEFAULT_FILE = '/home/test/.config/mw/config.json';

function deps(over: Partial<ConfigDeps> & { files?: Record<string, string> } = {}): ConfigDeps & { calls: [string, string][] } {
  const calls: [string, string][] = [];
  return {
    env: {},
    home: '/home/test',
    readFile: (p) => {
      const f = over.files?.[p];
      if (f === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return f;
    },
    runSecurity: (s, a) => {
      calls.push([s, a]);
      return 'kc-token\n';
    },
    ...over,
    calls,
  };
}

test('config file at the default path supplies url and token', () => {
  const c = loadConfig(deps({ files: { [DEFAULT_FILE]: '{"url":"https://h.test/v1/","token":"file-tok"}' } }));
  assert.deepEqual(c, { url: 'https://h.test/v1', token: 'file-tok', tokenSource: 'config file' });
});

test('MW_CONFIG selects another file and must exist', () => {
  const files = { '/tmp/alt.json': '{"url":"https://alt.test/v1","token":"t"}' };
  assert.equal(loadConfig(deps({ env: { MW_CONFIG: '/tmp/alt.json' }, files })).url, 'https://alt.test/v1');
  assert.throws(() => loadConfig(deps({ env: { MW_CONFIG: '/tmp/missing.json', MW_URL: BASE, MW_TOKEN: 't' } })), ConfigError);
});

test('MW_URL and MW_TOKEN override the file; no file is fine when env is complete', () => {
  const files = { [DEFAULT_FILE]: '{"url":"https://file.test/v1","token":"file-tok"}' };
  const c = loadConfig(deps({ env: { MW_URL: 'https://env.test/v1', MW_TOKEN: 'env-tok' }, files }));
  assert.deepEqual(c, { url: 'https://env.test/v1', token: 'env-tok', tokenSource: 'env MW_TOKEN' });
  assert.equal(loadConfig(deps({ env: { MW_URL: BASE, MW_TOKEN: 'x' } })).tokenSource, 'env MW_TOKEN');
});

test('token order: MW_TOKEN, then config token, then Keychain; Keychain is lazy', () => {
  const kc = '"keychain":{"service":"svc","account":"acc"}';
  const files = { [DEFAULT_FILE]: `{"url":"${BASE}","token":"file-tok",${kc}}` };
  const d1 = deps({ env: { MW_TOKEN: 'e' }, files });
  assert.equal(loadConfig(d1).token, 'e');
  const d2 = deps({ files });
  assert.equal(loadConfig(d2).token, 'file-tok');
  assert.equal(d2.calls.length, 0);
  const d3 = deps({ files: { [DEFAULT_FILE]: `{"url":"${BASE}",${kc}}` } });
  const c = loadConfig(d3);
  assert.deepEqual(c, { url: BASE, token: 'kc-token', tokenSource: 'keychain svc/acc' });
  assert.deepEqual(d3.calls, [['svc', 'acc']]);
});

test('missing token, missing url, bad file contents are ConfigErrors', () => {
  const bad: [Partial<ConfigDeps> & { files?: Record<string, string> }, RegExp][] = [
    [{ env: { MW_URL: BASE } }, /no token/],
    [{ files: { [DEFAULT_FILE]: '{"token":"t"}' } }, /no API URL/],
    [{ env: { MW_URL: 'ftp://x', MW_TOKEN: 't' } }, /http/],
    [{ env: { MW_URL: 'nonsense', MW_TOKEN: 't' } }, /not a valid URL/],
    [{ files: { [DEFAULT_FILE]: '{oops' } }, /invalid JSON/],
    [{ files: { [DEFAULT_FILE]: '[]' } }, /JSON object/],
    [{ files: { [DEFAULT_FILE]: '{"urll":"x"}' } }, /unknown key "urll"/],
    [{ files: { [DEFAULT_FILE]: '{"token":5}' } }, /token/],
    [{ files: { [DEFAULT_FILE]: `{"url":"${BASE}","keychain":{"service":"s"}}` } }, /keychain\.account/],
    [{ env: { MW_URL: BASE }, files: { [DEFAULT_FILE]: '{"keychain":{"service":"s","account":"a"}}' }, runSecurity: () => { throw new Error('x'); } }, /Keychain item s\/a/],
    [{ env: { MW_URL: BASE }, files: { [DEFAULT_FILE]: '{"keychain":{"service":"s","account":"a"}}' }, runSecurity: () => '\n' }, /empty/],
  ];
  for (const [over, re] of bad) assert.throws(() => loadConfig(deps(over)), (e: unknown) => e instanceof ConfigError && re.test(e.message), String(re));
});

test('displayUrl shows the host only', () => {
  assert.equal(displayUrl('https://mindwtr.example.com:8443/v1/secret-path'), 'https://mindwtr.example.com:8443/…');
});

test('missing token exits 3 through the CLI and never calls security', async () => {
  const h = harness({ env: { MW_URL: BASE } });
  const r = await h.run('areas');
  assert.equal(r.code, 3);
  assert.match(r.err, /no token/);
  assert.equal(h.securityCalls.length, 0);
  assert.equal(h.requests.length, 0);
});

test('Keychain token is used through the CLI (mocked runner) and sent as the bearer', async () => {
  const h = harness({
    env: { MW_CONFIG: '/c.json' },
    files: { '/c.json': `{"url":"${BASE}","keychain":{"service":"svc","account":"acc"}}` },
    security: () => `${TOKEN}\n`,
    handler: () => ({ body: { areas: [] } }),
  });
  const r = await h.run('areas');
  assert.equal(r.code, 0);
  assert.equal(h.requests[0]?.headers.authorization, `Bearer ${TOKEN}`);
});

test('whoami prints host and token source, never the token', async () => {
  const h = harness({
    env: { MW_CONFIG: '/c.json' },
    files: { '/c.json': `{"url":"${BASE}","keychain":{"service":"svc","account":"acc"}}` },
    security: () => TOKEN,
    handler: () => ({ body: { areas: [] } }),
  });
  const r = await h.run('whoami');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'url:    https://mw.test/…\ntoken:  keychain svc/acc\naccess: ok\n');
  assert.equal((r.out + r.err).includes(TOKEN), false);
  assert.equal(h.requests[0]?.path, '/areas?limit=1');

  const denied = harness({ handler: () => ({ status: 401, raw: 'no' }) });
  const d = await denied.run('whoami');
  assert.equal(d.code, 3);
  assert.equal((d.out + d.err).includes(TOKEN), false);
  assert.doesNotMatch(d.out, /access: ok/);
});
