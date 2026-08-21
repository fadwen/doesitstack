// The fetch is the only network-facing code here, and its whole job is to not
// download 8 MB it already has. Exercised against a local server so the test is
// hermetic — it never reaches items.sodeq.org.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fetchItems } from '../tools/fetch_items.mjs';

const BODY = 'id|name|clickeffect\n1|Cloak|500\n';
const ETAG = '"abc123"';
const LAST_MODIFIED = 'Fri, 21 Aug 2026 08:00:23 GMT';

/** A stand-in for the dump host. Records what it was asked, honours conditionals. */
function serve({ conditional = true } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    if (conditional &&
        (req.headers['if-none-match'] === ETAG || req.headers['if-modified-since'] === LAST_MODIFIED)) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { etag: ETAG, 'last-modified': LAST_MODIFIED });
    res.end(zlib.gzipSync(Buffer.from(BODY)));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/items.txt.gz` })));
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dis-fetch-'));
const quiet = () => {};

test('the first fetch downloads and unpacks the dump', async () => {
  const { server, url } = await serve();
  const dir = tmp();
  try {
    const r = await fetchItems({ url, dir, log: quiet });
    assert.equal(r.skipped, false);
    assert.equal(fs.readFileSync(path.join(dir, 'items.txt'), 'utf8'), BODY);
    assert.equal(r.etag, ETAG);
  } finally { server.close(); }
});

test('an unchanged dump is not downloaded again', async () => {
  const { server, seen, url } = await serve();
  const dir = tmp();
  try {
    await fetchItems({ url, dir, log: quiet });
    const second = await fetchItems({ url, dir, log: quiet });
    assert.equal(second.skipped, true, 'the second call should have been a 304');
    assert.equal(seen[1]['if-none-match'], ETAG);
    assert.equal(seen[1]['if-modified-since'], LAST_MODIFIED);
    assert.equal(fs.readFileSync(path.join(dir, 'items.txt'), 'utf8'), BODY, 'the file survives a skip');
  } finally { server.close(); }
});

test('--force re-downloads regardless', async () => {
  const { server, seen, url } = await serve();
  const dir = tmp();
  try {
    await fetchItems({ url, dir, log: quiet });
    const second = await fetchItems({ url, dir, force: true, log: quiet });
    assert.equal(second.skipped, false);
    assert.ok(!seen[1]['if-none-match'], 'force must not send a conditional header');
  } finally { server.close(); }
});

test('a server that ignores conditionals still works, just less cheaply', async () => {
  const { server, url } = await serve({ conditional: false });
  const dir = tmp();
  try {
    await fetchItems({ url, dir, log: quiet });
    const second = await fetchItems({ url, dir, log: quiet });
    assert.equal(second.skipped, false, 'no 304 means a full download — correct, not an error');
    assert.equal(fs.readFileSync(path.join(dir, 'items.txt'), 'utf8'), BODY);
  } finally { server.close(); }
});

test('an HTTP error leaves the existing file untouched', async () => {
  const dir = tmp();
  const good = await serve();
  try {
    await fetchItems({ url: good.url, dir, log: quiet });
  } finally { good.server.close(); }

  const bad = http.createServer((_, res) => res.writeHead(503).end());
  await new Promise(r => bad.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${bad.address().port}/items.txt.gz`;
  try {
    await assert.rejects(() => fetchItems({ url, dir, force: true, log: quiet }), /HTTP 503/);
    assert.equal(fs.readFileSync(path.join(dir, 'items.txt'), 'utf8'), BODY,
      'a failed refresh must not destroy the copy we had');
    assert.ok(!fs.existsSync(path.join(dir, 'items.txt.part')), 'no half-written temp file left behind');
  } finally { bad.close(); }
});
