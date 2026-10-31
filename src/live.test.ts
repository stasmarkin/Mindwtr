import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './main.ts';
import { realDeps } from './runtime.ts';

// Real server, real environment: MW_URL (or MW_CONFIG) plus MW_TOKEN or a Keychain entry. Output is never logged.
async function mw(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await runCli(argv, { ...realDeps(), stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } });
  return { code, out, err };
}

const live = process.env.MW_LIVE === '1';
const liveWrite = process.env.MW_LIVE_WRITE === '1';

test('live read smoke: whoami, areas, tasks', { skip: !live && 'set MW_LIVE=1' }, async () => {
  for (const argv of [['whoami'], ['areas'], ['tasks', '--status', 'inbox', '--limit', '5']]) {
    const r = await mw(...argv);
    assert.equal(r.code, 0, `${argv[0]} exited ${r.code}: ${r.err.slice(0, 200)}`);
  }
});

test('live write smoke: add, get, update, delete', { skip: !liveWrite && 'set MW_LIVE_WRITE=1' }, async () => {
  const title = `mw smoke ${new Date().toISOString()}`;
  const added = await mw('add', title, '--status', 'inbox', '--json');
  assert.equal(added.code, 0, added.err.slice(0, 200));
  const id = (JSON.parse(added.out) as { task: { id: string } }).task.id;
  try {
    const got = await mw('get', id, '--json');
    assert.equal(got.code, 0);
    assert.equal((JSON.parse(got.out) as { task: { title: string } }).task.title, title);
    const upd = await mw('update', id, '--desc', 'smoke', '--priority', 'low', '--json');
    assert.equal(upd.code, 0, upd.err.slice(0, 200));
    const again = await mw('get', id, '--json');
    assert.equal((JSON.parse(again.out) as { task: { description: string } }).task.description, 'smoke');
  } finally {
    const del = await mw('delete', id);
    assert.equal(del.code, 0, del.err.slice(0, 200));
  }
});
