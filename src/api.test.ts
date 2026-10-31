import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, retryAfterMs, TokenBucket } from './api.ts';
import { ApiError } from './errors.ts';

function clock() {
  const c = { t: 1_000_000, sleeps: [] as number[] };
  return {
    c,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
}

test('token bucket: 100 immediate requests, the 101st waits for a refill', async () => {
  const { c, now, sleep } = clock();
  const b = new TokenBucket(now, sleep);
  for (let i = 0; i < 100; i++) await b.take();
  assert.deepEqual(c.sleeps, []);
  await b.take();
  assert.deepEqual(c.sleeps, [600]);
  await b.take();
  assert.deepEqual(c.sleeps, [600, 600]);
});

test('token bucket refills over time and never exceeds capacity', async () => {
  const { c, now, sleep } = clock();
  const b = new TokenBucket(now, sleep);
  for (let i = 0; i < 100; i++) await b.take();
  c.t += 120_000;
  for (let i = 0; i < 100; i++) await b.take();
  assert.deepEqual(c.sleeps, [], 'capacity caps the refill at 100');
  await b.take();
  assert.equal(c.sleeps.length, 1);
});

test('retryAfterMs: numeric seconds, 2 s fallback, capped', () => {
  assert.equal(retryAfterMs('3'), 3000);
  assert.equal(retryAfterMs('0.5'), 500);
  assert.equal(retryAfterMs(null), 2000);
  assert.equal(retryAfterMs('soon'), 2000);
  assert.equal(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT'), 2000);
  assert.equal(retryAfterMs('99999'), 60_000);
});

function apiWith(replies: Response[]) {
  const { c, now, sleep } = clock();
  let i = 0;
  const calls: string[] = [];
  const f: typeof fetch = async (u) => {
    calls.push(String(u));
    const r = replies[i++];
    if (r === undefined) throw new Error('unexpected request');
    return r;
  };
  return { api: new Api({ baseUrl: 'https://x.test/v1', token: 't', fetch: f, now, sleep }), c, calls };
}

test('429 waits for Retry-After and retries once', async () => {
  const { api, c, calls } = apiWith([new Response('slow', { status: 429, headers: { 'Retry-After': '7' } }), new Response('{"ok":1}')]);
  const r = await api.get('/areas');
  assert.deepEqual(r.data, { ok: 1 });
  assert.deepEqual(c.sleeps, [7000]);
  assert.equal(calls.length, 2);
});

test('429 without a usable Retry-After waits 2 s', async () => {
  const { api, c } = apiWith([new Response('', { status: 429 }), new Response('{}')]);
  await api.get('/areas');
  assert.deepEqual(c.sleeps, [2000]);
});

test('a second 429 is an ApiError', async () => {
  const { api, calls } = apiWith([new Response('a', { status: 429 }), new Response('b', { status: 429 })]);
  await assert.rejects(api.get('/areas'), (e: unknown) => e instanceof ApiError && e.status === 429 && e.body === 'b');
  assert.equal(calls.length, 2);
});

test('non-JSON success body does not throw', async () => {
  const { api } = apiWith([new Response('plain')]);
  const r = await api.get('/x');
  assert.equal(r.data, undefined);
  assert.equal(r.text, 'plain');
});
