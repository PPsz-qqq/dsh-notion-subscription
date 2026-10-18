import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotionSubscriptionAdapter } from '../src/index.js';
import { CaptureSink } from '../src/capture.js';

const cfg = {
  enabled: true, autoDiscover: false, autoModels: false, cookie: 'synthetic-secret-token', completionMode: 'stream-end',
  spaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  notionHost: 'app.notion.com',
};
function ndjson(frames) {
  const text = frames.map((f) => JSON.stringify(f)).join('\n') + '\n';
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } });
}
const answered = () => ndjson([
  { type: 'patch', v: [{ o: 'a', p: '/s/-', v: { type: 'text', value: [{ type: 'text', content: 'hi from upstream' }] } }] },
]);

test('capture records the request and every frame, never the cookie', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notion-capture-'));
  try {
    const adapter = new NotionSubscriptionAdapter({ ...cfg, captureDir: dir }, { environment: {}, fetchFn: async () => answered() });
    for await (const _chunk of adapter.stream({ provider: 'notion-subscription', model: 'claude-sonnet4.6', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] })) {}
    const files = await readdir(dir);
    const requestFile = files.find((f) => f.endsWith('.request.json'));
    const framesFile = files.find((f) => f.endsWith('.frames.ndjson'));
    assert.ok(requestFile, 'a request record is written');
    assert.ok(framesFile, 'a frame record is written');
    const request = JSON.parse(await readFile(join(dir, requestFile), 'utf8'));
    assert.equal(request.body.transcript[0].value.model, 'almond-croissant-low');
    assert.equal('cookie' in request.headers, false, 'credentials are never captured');
    const raw = await readFile(join(dir, requestFile), 'utf8');
    assert.ok(!raw.includes('synthetic-secret-token'), 'the cookie value must not appear');
    const frames = (await readFile(join(dir, framesFile), 'utf8')).trim().split('\n');
    assert.equal(frames.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('capture is silent when no directory is configured', async () => {
  const adapter = new NotionSubscriptionAdapter(cfg, { environment: {}, fetchFn: async () => answered() });
  await assert.doesNotReject(async () => {
    for await (const _chunk of adapter.stream({ provider: 'notion-subscription', model: 'claude-sonnet4.6', messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] })) {}
  });
  const sink = new CaptureSink({ enabled: false, directory: '' });
  await sink.record('x', { requestBody: {}, headers: {}, frames: [] });
  assert.equal(sink.error, null);
});
test('a capture failure never breaks a working call', async () => {
  const sink = new CaptureSink({ enabled: true, directory: '\u0000invalid-path' });
  await sink.record('x', { requestBody: {}, headers: {}, frames: [] });
  assert.ok(sink.error, 'the failure is recorded rather than thrown');
});