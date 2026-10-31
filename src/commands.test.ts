import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, harness, TOKEN } from './test/harness.ts';
import type { Handler } from './test/harness.ts';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID2 = 'aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AREA_HOME = { id: 'area-home', name: 'Home' };
const AREA_WORK = { id: 'area-work', name: 'Work' };
const PROJ = { id: 'proj-1', title: 'Renovation', areaId: 'area-home', status: 'active' };

const lists: Handler = (req) => {
  const p = req.path.split('?')[0];
  if (p === '/areas') return { body: { areas: [AREA_HOME, AREA_WORK, { id: 'gone', name: 'Old', deletedAt: '2026-01-01' }] } };
  if (p === '/projects') return { body: { projects: [PROJ, { id: 'proj-2', title: 'work', areaId: 'area-work' }, { id: 'proj-3', title: 'Work', areaId: 'area-work' }] } };
  return undefined;
};

test('usage errors exit 1 and never touch the network', async () => {
  const bad: string[][] = [
    [],
    ['bogus'],
    ['tasks', '--status', 'nope'],
    ['tasks', '--limit', '0'],
    ['tasks', '--limit', '1001'],
    ['tasks', '--limit', 'x'],
    ['tasks', '--due-before', '2026-13-40'],
    ['tasks', 'extra'],
    ['tasks', '--nope'],
    ['get'],
    ['get', 'a', 'b'],
    ['add'],
    ['add', '   '],
    ['add', 'x', '--due', 'tomorrow'],
    ['add', 'x', '--due', '2026-02-30'],
    ['add', 'x', '--start', '2026/01/01'],
    ['add', 'x', '--priority', 'huge'],
    ['add', 'x', '--status', 'bad'],
    ['add', 'x', '--unknown'],
    ['update', ID],
    ['update', ID, '--due', '2026-01-01', '--no-due'],
    ['update', ID, '--start', '2026-01-01', '--no-start'],
    ['update', ID, '--focus', '--no-focus'],
    ['update', ID, '--order', 'x'],
    ['update', ID, '--title', ' '],
    ['complete'],
    ['archive', 'a', 'b'],
    ['delete'],
    ['sections'],
    ['search'],
    ['whoami', 'x'],
  ];
  for (const argv of bad) {
    const h = harness();
    const r = await h.run(...argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.equal(h.requests.length, 0, argv.join(' '));
    assert.match(r.err, /^(mw: |usage:)/, argv.join(' '));
  }
});

test('help prints usage and exits 0', async () => {
  const r = await harness().run('help');
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: mw/);
});

test('tasks sends server-side params and the bearer token', async () => {
  const h = harness({ handler: () => ({ body: { tasks: [{ id: ID, status: 'inbox', title: 'Buy milk', dueDate: '2026-03-01', isFocusedToday: true }] } }) });
  const r = await h.run('tasks', '--status', 'inbox', '--limit', '5', '--focus', '--all');
  assert.equal(r.code, 0);
  const req = h.requests[0];
  assert.equal(req?.method, 'GET');
  assert.equal(req?.path, '/tasks?status=inbox&all=1&isFocusedToday=true&limit=5');
  assert.equal(req?.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(r.out, 'ID        STATUS  DUE         TITLE\naaaaaaaa  inbox   2026-03-01  * Buy milk\n');
});

test('tasks without flags sends no status and no limit', async () => {
  const h = harness({ handler: () => ({ body: { tasks: [] } }) });
  const r = await h.run('tasks');
  assert.equal(h.requests[0]?.path, '/tasks');
  assert.equal(r.out, 'no tasks\n');
});

test('tasks --json prints the raw body as received', async () => {
  const body = { tasks: [{ id: ID, title: 't', extra: { a: 1 } }], page: 7 };
  const h = harness({ handler: () => ({ body }) });
  const r = await h.run('tasks', '--json');
  assert.deepEqual(JSON.parse(r.out), body);
});

test('tasks client-side filters fetch 1000 and apply --limit after filtering', async () => {
  const tasks = [
    { id: 't1', title: 'a', projectId: 'proj-1', dueDate: '2026-01-10' },
    { id: 't2', title: 'b', projectId: 'proj-1', dueDate: '2026-03-10' },
    { id: 't3', title: 'c', projectId: 'proj-2', dueDate: '2026-01-05' },
    { id: 't4', title: 'd', areaId: 'area-home', dueDate: '2026-01-01T09:00' },
    { id: 't5', title: 'e', projectId: 'proj-1' },
  ];
  const h = harness({ handler: (req) => lists(req, 0) ?? { body: { tasks } } });

  let r = await h.run('tasks', '--project', 'proj-1', '--limit', '1', '--json');
  assert.deepEqual(JSON.parse(r.out), { tasks: [tasks[0]] });
  assert.equal(h.requests.find((q) => q.path.startsWith('/tasks'))?.path, '/tasks?limit=1000&offset=0');

  r = await h.run('tasks', '--project', 'Renovation', '--due-before', '2026-02-01', '--json');
  assert.deepEqual(JSON.parse(r.out), { tasks: [tasks[0]] });

  // Area filter includes tasks of the area's projects (t1, t2, t5) and direct ones (t4).
  r = await h.run('tasks', '--area', 'home', '--json');
  assert.deepEqual((JSON.parse(r.out) as { tasks: { id: string }[] }).tasks.map((t) => t.id), ['t1', 't2', 't4', 't5']);

  r = await h.run('tasks', '--due-before', '2026-01-02', '--json');
  assert.deepEqual((JSON.parse(r.out) as { tasks: { id: string }[] }).tasks.map((t) => t.id), ['t4']);
});

test('area/project name resolution: id, case-insensitive name, ambiguous, not found, deleted ignored', async () => {
  const h = harness({ handler: (req) => lists(req, 0) ?? { body: { tasks: [] } } });
  assert.equal((await h.run('tasks', '--area', 'area-work')).code, 0);
  assert.equal((await h.run('tasks', '--area', 'HOME')).code, 0);

  let r = await h.run('tasks', '--project', 'work');
  assert.equal(r.code, 1);
  assert.match(r.err, /ambiguous/);
  assert.match(r.err, /proj-2/);
  assert.match(r.err, /proj-3/);

  r = await h.run('tasks', '--area', 'Old');
  assert.equal(r.code, 1, 'soft-deleted areas do not resolve');
  assert.match(r.err, /no area named "Old"; available: "Home", "Work"/);

  r = await h.run('tasks', '--area', 'Nope');
  assert.equal(r.code, 1);
});

test('not-found hint lists at most 10 names', async () => {
  const areas = Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, name: `Area ${i}` }));
  const r = await harness({ handler: () => ({ body: { areas } }) }).run('tasks', '--area', 'zzz');
  assert.equal(r.code, 1);
  assert.match(r.err, /"Area 9"/);
  assert.doesNotMatch(r.err, /"Area 10"/);
  assert.match(r.err, /3 more/);
});

test('get prints a key: value block and resolves id prefixes', async () => {
  const task = { id: ID, title: 'Buy milk', status: 'next', areaId: 'area-home', dueDate: '2026-03-01', tags: ['#a', '#b'], contexts: ['@home'], isFocusedToday: false, description: 'two\nlines' };
  const h = harness({
    handler: (req) => (req.path.startsWith('/tasks?') ? { body: { tasks: [{ id: ID }, { id: ID2 }] } } : { body: { task } }),
  });
  const r = await h.run('get', ID);
  assert.equal(r.code, 0);
  assert.equal(h.requests[0]?.path, `/tasks/${ID}`);
  assert.match(r.out, /^title:\s+Buy milk\nid:\s+aaaaaaaa-/);
  assert.match(r.out, /tags:\s+#a, #b/);
  assert.match(r.out, /focus:\s+no/);
  assert.match(r.out, /description:\ntwo\nlines\n$/);

  const raw = await h.run('get', ID, '--json');
  assert.deepEqual(JSON.parse(raw.out), { task });

  // Prefix: one lookup, then the real GET.
  h.requests.length = 0;
  assert.equal((await h.run('get', 'aaaaaaaa-b')).code, 0);
  assert.equal(h.requests[0]?.path, '/tasks?all=1&limit=1000&offset=0');
  assert.equal(h.requests[1]?.path, `/tasks/${ID2}`);

  const amb = await h.run('get', 'aaaaaaaa');
  assert.equal(amb.code, 1);
  assert.match(amb.err, /ambiguous/);
  const none = await h.run('get', 'ffff');
  assert.equal(none.code, 1);
});

test('add builds {title, props} with only the provided props', async () => {
  const h = harness({ handler: (req) => lists(req, 0) ?? { body: { task: { id: ID, title: 'Buy milk' } } } });
  let r = await h.run('add', 'Buy milk');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'added aaaaaaaa Buy milk\n');
  assert.deepEqual(h.requests[0], { method: 'POST', path: '/tasks', headers: h.requests[0]?.headers ?? {}, body: { title: 'Buy milk', props: {} } });
  assert.equal(h.requests[0]?.headers['content-type'], 'application/json');

  h.requests.length = 0;
  r = await h.run('add', 'Plan', '--status', 'next', '--area', 'Home', '--project', 'Renovation', '--due', '2026-03-01', '--start', '2026-02-01', '--desc', 'notes', '--tag', '#x', '--tag', 'y', '--context', '@home', '--priority', 'high', '--focus');
  assert.equal(r.code, 0);
  assert.deepEqual(h.requests.at(-1)?.body, {
    title: 'Plan',
    props: {
      status: 'next',
      areaId: 'area-home',
      projectId: 'proj-1',
      dueDate: '2026-03-01',
      startTime: '2026-02-01',
      description: 'notes',
      tags: ['#x', 'y'],
      contexts: ['@home'],
      priority: 'high',
      isFocusedToday: true,
    },
  });
});

test('update: GET for ETag, PATCH with If-Match, flat body, nulls for --no-due/--no-start', async () => {
  const h = harness({
    handler: (req) =>
      req.method === 'GET' ? { body: { task: { id: ID } }, headers: { ETag: '"v1"' } } : { body: { task: { id: ID, title: 'New' } } },
  });
  const r = await h.run('update', ID, '--title', 'New', '--no-due', '--no-start', '--no-focus', '--order', '3', '--tag', 'a');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'updated aaaaaaaa New\n');
  assert.deepEqual(h.requests.map((q) => `${q.method} ${q.path}`), [`GET /tasks/${ID}`, `PATCH /tasks/${ID}`]);
  assert.equal(h.requests[1]?.headers['if-match'], '"v1"');
  assert.deepEqual(h.requests[1]?.body, { title: 'New', dueDate: null, startTime: null, isFocusedToday: false, order: 3, tags: ['a'] });
});

test('update without an ETag patches without If-Match', async () => {
  const h = harness({ handler: () => ({ body: { task: { id: ID } } }) });
  assert.equal((await h.run('update', ID, '--focus')).code, 0);
  assert.equal(h.requests[1]?.headers['if-match'], undefined);
  assert.deepEqual(h.requests[1]?.body, { isFocusedToday: true });
});

test('update retries once on 412 with a fresh ETag, a second 412 exits 2', async () => {
  let patches = 0;
  const h = harness({
    handler: (req, n) => {
      if (req.method === 'GET') return { body: { task: { id: ID } }, headers: { ETag: `"v${n}"` } };
      patches++;
      return patches === 1 ? { status: 412, raw: 'changed' } : { body: { task: { id: ID, title: 'T' } } };
    },
  });
  let r = await h.run('update', ID, '--title', 'T');
  assert.equal(r.code, 0);
  assert.deepEqual(h.requests.map((q) => q.method), ['GET', 'PATCH', 'GET', 'PATCH']);
  assert.equal(h.requests[1]?.headers['if-match'], '"v1"');
  assert.equal(h.requests[3]?.headers['if-match'], '"v3"');

  const always = harness({ handler: (req) => (req.method === 'GET' ? { body: { task: {} }, headers: { ETag: '"x"' } } : { status: 412, raw: 'nope' }) });
  r = await always.run('update', ID, '--title', 'T');
  assert.equal(r.code, 2);
  assert.equal(always.requests.length, 4);
  assert.equal(r.err, `mw: PATCH /tasks/${ID} -> 412\nnope\n`);
});

test('update with only --area resolves the name', async () => {
  const h = harness({ handler: (req) => lists(req, 0) ?? { body: { task: { id: ID } } } });
  assert.equal((await h.run('update', ID, '--area', 'work')).code, 0);
  assert.deepEqual(h.requests.find((q) => q.method === 'PATCH')?.body, { areaId: 'area-work' });
});

test('complete, archive, delete use the documented endpoints', async () => {
  const h = harness({ handler: () => ({ body: { task: { id: ID, title: 'T' } } }) });
  assert.equal((await h.run('complete', ID)).out, 'completed aaaaaaaa T\n');
  assert.equal((await h.run('archive', ID)).out, 'archived aaaaaaaa T\n');
  assert.equal((await h.run('delete', ID)).out, 'deleted aaaaaaaa T\n');
  assert.deepEqual(h.requests.map((q) => `${q.method} ${q.path}`), [`POST /tasks/${ID}/complete`, `POST /tasks/${ID}/archive`, `DELETE /tasks/${ID}`]);
  const bare = harness({ handler: () => ({ body: { ok: true } }) });
  assert.equal((await bare.run('delete', ID)).out, 'deleted aaaaaaaa\n');
});

test('areas, projects, sections, search', async () => {
  const h = harness({
    handler: (req) => {
      if (req.path.startsWith('/sections')) return { body: { sections: [{ id: 's1234567-x', title: 'Phase 1' }] } };
      if (req.path.startsWith('/search')) return { body: { tasks: [{ id: ID, status: 'next', title: 'Found' }], projects: [PROJ] } };
      return lists(req, 0);
    },
  });
  assert.equal((await h.run('areas')).out, 'ID        NAME\narea-hom  Home\narea-wor  Work\n');
  const projects = await h.run('projects');
  assert.match(projects.out, /^ID +NAME +STATUS\nproj-1 +Renovation +active\n/);
  const sections = await h.run('sections', 'Renovation');
  assert.equal(h.requests.at(-1)?.path, '/sections?projectId=proj-1');
  assert.match(sections.out, /Phase 1/);
  const search = await h.run('search', 'mil k&');
  assert.equal(h.requests.at(-1)?.path, '/search?query=mil+k%26');
  assert.match(search.out, /Found/);
  assert.match(search.out, /projects\nID/);
  assert.equal((await h.run('areas', '--json')).out.includes('"areas"'), true);
});

test('terminal escapes in task text are neutralised in tables', async () => {
  const h = harness({ handler: () => ({ body: { tasks: [{ id: ID, status: 'inbox', title: 'a\u001b[31mb\nc' }] } }) });
  const r = await h.run('tasks');
  assert.equal(r.out.includes('\u001b'), false);
  assert.match(r.out, /a \[31mb c\n$/);
});

test('exit codes: API error 2 with method/path/status/body, 401 -> 3, network failure -> 2', async () => {
  let r = await harness({ handler: () => ({ status: 404, raw: '{"error":"not found"}' }) }).run('get', ID);
  assert.equal(r.code, 2);
  assert.equal(r.err, `mw: GET /tasks/${ID} -> 404\n{"error":"not found"}\n`);

  r = await harness({ handler: () => ({ status: 401, raw: 'bad token' }) }).run('areas');
  assert.equal(r.code, 3);
  assert.doesNotMatch(r.err, new RegExp(TOKEN));

  r = await harness({ handler: () => ({ status: 500, raw: 'boom' }) }).run('tasks', '--status', 'inbox');
  assert.equal(r.code, 2);
  assert.match(r.err, /GET \/tasks\?status=inbox -> 500\nboom/);

  const failing = harness({ handler: () => { throw new Error('connection refused'); } });
  r = await failing.run('areas');
  assert.equal(r.code, 2);
  assert.match(r.err, /network error\nconnection refused/);
});

test('baseUrl comes from config with trailing slashes trimmed', async () => {
  const h = harness({ env: { MW_URL: `${BASE}//`, MW_TOKEN: TOKEN }, handler: () => ({ body: { areas: [] } }) });
  assert.equal((await h.run('areas')).code, 0);
});

const page = (from: number, n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(from + i).padStart(8, '0')}-0000-4000-8000-000000000000`, title: `t${from + i}` }));

test('task id prefix lookup pages through all tasks: a twin on page 2 makes the prefix ambiguous', async () => {
  const twin = { id: 'zzzz0001-0000-4000-8000-000000000000', title: 'twin' };
  const h = harness({
    handler: (req) => {
      if (!req.path.startsWith('/tasks?')) return { body: { task: {} } };
      return req.path.includes('offset=0')
        ? { body: { tasks: [...page(0, 999, 'a'), { id: 'zzzz9999-0000-4000-8000-000000000000', title: 'one' }] } }
        : { body: { tasks: [twin] } };
    },
  });
  const r = await h.run('delete', 'zzzz');
  assert.equal(r.code, 1);
  assert.match(r.err, /ambiguous/);
  assert.deepEqual(h.requests.map((q) => q.path), ['/tasks?all=1&limit=1000&offset=0', '/tasks?all=1&limit=1000&offset=1000']);
  assert.equal(h.requests.some((q) => q.method === 'DELETE'), false);
});

test('task id prefix: shorter than 4 chars is a usage error without requests; a full id skips the lookup', async () => {
  const h = harness({ handler: () => ({ body: { task: { id: ID } } }) });
  const r = await h.run('delete', 'aaa');
  assert.equal(r.code, 1);
  assert.match(r.err, /too short/);
  assert.equal(h.requests.length, 0);
  await h.run('get', ID);
  assert.deepEqual(h.requests.map((q) => q.path), [`/tasks/${ID}`]);
});

test('client-side filters see tasks beyond the first 1000', async () => {
  const h = harness({
    handler: (req) => {
      const l = lists(req, 0);
      if (l !== undefined) return l;
      return req.path.includes('offset=0')
        ? { body: { tasks: page(0, 1000, 'a').map((t) => ({ ...t, projectId: 'other' })) } }
        : { body: { tasks: [{ id: 'late', title: 'late', projectId: 'proj-1' }] } };
    },
  });
  const r = await h.run('tasks', '--project', 'proj-1', '--json');
  assert.deepEqual(JSON.parse(r.out), { tasks: [{ id: 'late', title: 'late', projectId: 'proj-1' }] });
});

test('area filter takes the area from a live project, the own areaId only without one', async () => {
  const tasks = [
    { id: 't1', title: 'in work project, stale home area', projectId: 'proj-2', areaId: 'area-home' },
    { id: 't2', title: 'no project, home', areaId: 'area-home' },
    { id: 't3', title: 'deleted project, own area', projectId: 'dead-proj', areaId: 'area-home' },
  ];
  const h = harness({ handler: (req) => lists(req, 0) ?? { body: { tasks } } });
  const ids = async (area: string) => ((JSON.parse((await h.run('tasks', '--area', area, '--json')).out) as { tasks: { id: string }[] }).tasks.map((t) => t.id));
  assert.deepEqual(await ids('area-home'), ['t2', 't3']);
  assert.deepEqual(await ids('area-work'), ['t1']);
});

test('area, project and sections accept a unique id prefix of 4+ chars', async () => {
  const h = harness({ handler: (req) => (req.path.startsWith('/sections') ? { body: { sections: [] } } : lists(req, 0) ?? { body: { tasks: [] } }) });
  assert.equal((await h.run('tasks', '--area', 'area-w')).code, 0);
  assert.equal((await h.run('sections', 'proj-1')).code, 0);
  assert.equal(h.requests.at(-1)?.path, '/sections?projectId=proj-1');
  let r = await h.run('tasks', '--project', 'proj-');
  assert.equal(r.code, 1);
  assert.match(r.err, /id prefix "proj-" is ambiguous/);
  r = await h.run('tasks', '--area', 'are');
  assert.equal(r.code, 1);
  assert.match(r.err, /no area named "are"/);
});

test('update does not retry after 412 when another client changed a field we write', async () => {
  let gets = 0;
  const h = harness({
    handler: (req) => (req.method === 'GET' ? { body: { task: { title: gets++ === 0 ? 'A' : 'B', status: 'next' } }, headers: { ETag: '"e"' } } : { status: 412, raw: 'changed' }),
  });
  const r = await h.run('update', ID, '--title', 'mine', '--status', 'next');
  assert.equal(r.code, 2);
  assert.match(r.err, /conflict: title changed by another client/);
  assert.deepEqual(h.requests.map((q) => q.method), ['GET', 'PATCH', 'GET']);
});

test('human output neutralises escapes in tags, contexts and description; --json stays raw', async () => {
  const task = { id: ID, title: 't', status: 'next', tags: ['a\u001b[1m'], contexts: ['c\u0007'], description: 'd\u001b]0;x\u0007' };
  const h = harness({ handler: () => ({ body: { task } }) });
  const human = await h.run('get', ID);
  assert.equal(/[\u001b\u0007]/.test(human.out), false);
  assert.equal((await h.run('get', ID, '--json')).out.includes('\\u001b'), true);
});

test('search tolerates a response without projects', async () => {
  const h = harness({ handler: () => ({ body: { tasks: [{ id: ID, status: 'next', title: 'Found' }] } }) });
  const r = await h.run('search', 'x');
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /projects/);
});

test('every attempt carries a timeout signal; a timeout is an API error with a clear message', async () => {
  const signals: unknown[] = [];
  const { Api } = await import('./api.ts');
  const api = new Api({ baseUrl: BASE, token: 't', now: () => 0, sleep: async () => {}, fetch: async (_u, init) => { signals.push(init?.signal); return new Response('{}'); } });
  await api.get('/x');
  assert.ok(signals[0] instanceof AbortSignal);

  const t = harness({ handler: () => { throw new DOMException('aborted', 'TimeoutError'); } });
  const r = await t.run('areas');
  assert.equal(r.code, 2);
  assert.match(r.err, /network error\ntimeout after 30s/);
});

test('network errors include the underlying cause', async () => {
  const h = harness({ handler: () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') }); } });
  const r = await h.run('areas');
  assert.match(r.err, /fetch failed \(connect ECONNREFUSED 127\.0\.0\.1:1\)/);
});
