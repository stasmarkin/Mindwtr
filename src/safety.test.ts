import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditArgs } from './audit.ts';
import { BASE, harness, TOKEN } from './test/harness.ts';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ok = () => ({ body: { task: { id: ID, title: 'T' } } });
const withAudit = { MW_URL: BASE, MW_TOKEN: TOKEN, MW_AUDIT_LOG: '/log/audit.jsonl' };

test('audit: one JSON line per mutating command, appended', async () => {
  const h = harness({ env: withAudit, handler: ok });
  await h.run('add', 'Buy milk', '--tag', 'a');
  assert.equal(h.audit.length, 1);
  assert.equal(h.audit[0]?.path, '/log/audit.jsonl');
  const data = h.audit[0]?.data ?? '';
  assert.ok(data.endsWith('\n'));
  const line = JSON.parse(data) as Record<string, unknown>;
  assert.equal(line.cmd, 'add');
  assert.equal(line.ok, true);
  assert.equal(line.taskId, ID);
  assert.deepEqual(line.args, { tag: ['a'], _: ['Buy milk'] });
  assert.equal(new Date(String(line.ts)).toISOString(), line.ts);
  assert.equal(line.error, undefined);
  assert.equal(data.includes(TOKEN), false);
});

test('audit: update, complete, archive, delete are logged; reads are not', async () => {
  const h = harness({ env: withAudit, handler: ok });
  await h.run('update', ID, '--title', 'x');
  await h.run('complete', ID);
  await h.run('archive', ID);
  await h.run('delete', ID);
  assert.deepEqual(h.audit.map((a) => (JSON.parse(a.data) as { cmd: string }).cmd), ['update', 'complete', 'archive', 'delete']);
  const reads = harness({ env: withAudit, handler: () => ({ body: { tasks: [], areas: [] } }) });
  await reads.run('tasks');
  await reads.run('areas');
  await reads.run('whoami');
  assert.equal(reads.audit.length, 0);
});

test('audit: failures are logged with ok=false and the error; usage errors are not', async () => {
  const h = harness({ env: withAudit, handler: () => ({ status: 500, raw: 'boom' }) });
  const r = await h.run('delete', ID);
  assert.equal(r.code, 2);
  const line = JSON.parse(h.audit[0]?.data ?? '') as { ok: boolean; error: string; taskId: string };
  assert.equal(line.ok, false);
  assert.equal(line.taskId, ID);
  assert.match(line.error, /500/);
  assert.equal((await h.run('add')).code, 1);
  assert.equal(h.audit.length, 1);
});

test('audit: long desc is replaced by its length, short one is kept', () => {
  assert.deepEqual(auditArgs({ desc: 'x'.repeat(201) }, []), { desc: '<201 chars>' });
  assert.deepEqual(auditArgs({ desc: 'x'.repeat(200) }, []), { desc: 'x'.repeat(200) });
});

test('audit: a long desc never lands in the log', async () => {
  const h = harness({ env: withAudit, handler: ok });
  await h.run('add', 'T', '--desc', 'secret '.repeat(100));
  const data = h.audit[0]?.data ?? '';
  assert.match(data, /"desc":"<700 chars>"/);
  assert.equal(data.includes('secret'), false);
});

test('audit: the log is created owner-only (mode 0600)', async () => {
  const h = harness({ env: withAudit, handler: ok });
  await h.run('add', 'T');
  assert.deepEqual(h.audit[0]?.opts, { flag: 'a', mode: 0o600 });
});

test('audit: nothing is written when MW_AUDIT_LOG is unset', async () => {
  const h = harness({ handler: ok });
  await h.run('add', 'T');
  assert.equal(h.audit.length, 0);
});

test('audit: a failing log write warns on stderr but keeps the command result', async () => {
  const h = harness({ env: withAudit, handler: ok });
  // Rebuild with a throwing appender through the same harness shape.
  const { runCli } = await import('./main.ts');
  let err = '';
  const code = await runCli(['add', 'T'], {
    stdout: { write: () => true },
    stderr: { write: (s) => (err += s) },
    env: withAudit,
    home: '/h',
    readFile: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); },
    runSecurity: () => '',
    fetch: async () => new Response(JSON.stringify({ task: { id: ID } })),
    now: () => 0,
    sleep: async () => {},
    appendFile: () => { throw new Error('read-only'); },
  });
  assert.equal(code, 0);
  assert.match(err, /warning: cannot write audit log: read-only/);
  assert.equal(h.audit.length, 0);
});

test('dry run: mutating commands print method, path and body, call no mutation, and skip the audit log', async () => {
  const h = harness({ env: { ...withAudit, MW_DRY_RUN: '1' }, handler: () => ({ body: { areas: [{ id: 'a1', name: 'Home' }] } }) });

  let r = await h.run('add', 'Buy milk', '--area', 'Home', '--due', '2026-03-01');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'POST /tasks\n' + JSON.stringify({ title: 'Buy milk', props: { dueDate: '2026-03-01', areaId: 'a1' } }, null, 2) + '\n');
  // Only the name-resolution read hit the network.
  assert.deepEqual(h.requests.map((q) => `${q.method} ${q.path}`), ['GET /areas?limit=1000&offset=0']);

  h.requests.length = 0;
  r = await h.run('update', ID, '--title', 'x', '--no-due');
  assert.equal(r.out, `PATCH /tasks/${ID}\n${JSON.stringify({ title: 'x', dueDate: null }, null, 2)}\n`);
  r = await h.run('complete', ID);
  assert.equal(r.out, `POST /tasks/${ID}/complete\n`);
  r = await h.run('archive', ID);
  assert.equal(r.out, `POST /tasks/${ID}/archive\n`);
  r = await h.run('delete', ID);
  assert.equal(r.out, `DELETE /tasks/${ID}\n`);
  assert.equal(h.requests.length, 0, 'no GET for the ETag, no PATCH/POST/DELETE');
  assert.equal(h.audit.length, 0);
});

test('dry run does not affect reads', async () => {
  const h = harness({ env: { MW_URL: BASE, MW_TOKEN: TOKEN, MW_DRY_RUN: '1' }, handler: () => ({ body: { areas: [] } }) });
  assert.equal((await h.run('areas')).code, 0);
  assert.equal(h.requests.length, 1);
});
