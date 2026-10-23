// The dev server's argument handling.
//
// `npm run serve` forwards whatever you typed after it, so this gets fed odd
// things — a stray arrow from a pasted command line, a URL, an empty string.
// None of that should be a crash, and none of it should be a RangeError about
// sockets, which is what it used to be.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readPort, handle, fileFor, DEFAULT_PORT } from '../tools/serve.mjs';

const quiet = () => {};

test('no argument means the default port', () => {
  assert.equal(readPort(undefined, quiet), DEFAULT_PORT);
  assert.equal(readPort('', quiet), DEFAULT_PORT);
  assert.equal(readPort('   ', quiet), DEFAULT_PORT);
});

test('a real port is used', () => {
  assert.equal(readPort('8123', quiet), 8123);
  assert.equal(readPort('0', quiet), 0, 'port 0 is valid — the OS picks a free one');
  assert.equal(readPort('65535', quiet), 65535);
});

test('junk falls back instead of crashing', () => {
  // The actual case: `npm run serve → http://localhost:8000/set.html` passed the
  // arrow through, parseInt made it NaN, and net.listen threw ERR_SOCKET_BAD_PORT.
  for (const junk of ['→', 'http://localhost:8000/set.html', 'eight', '80.5', '-1', '65536', '1e9'])
    assert.equal(readPort(junk, quiet), DEFAULT_PORT, `readPort(${junk})`);
});

test('it says what it ignored, so the fallback is not silent', () => {
  const said = [];
  readPort('→', m => said.push(m));
  assert.equal(said.length, 1);
  assert.match(said[0], /→/);
  assert.match(said[0], new RegExp(String(DEFAULT_PORT)));
});

test('a valid port is accepted without comment', () => {
  const said = [];
  readPort('8123', m => said.push(m));
  assert.deepEqual(said, []);
});

// --- serving -----------------------------------------------------------------
//
// A scratch dist/ with a sibling directory beside it, served on an ephemeral
// port. The sibling is the point: it shares dist's path prefix.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-serve-'));
const root = path.join(tmp, 'dist');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'index.html'), '<title>x</title>');
fs.writeFileSync(path.join(root, 'icon.svg'), '<svg/>');
fs.mkdirSync(path.join(tmp, 'dist-old'));
fs.writeFileSync(path.join(tmp, 'dist-old', 'secret.txt'), 'no');

async function withServer(fn) {
  const srv = http.createServer((req, res) => handle(req, res, root));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const get = (p) => new Promise((resolve, reject) =>
    http.get(`http://127.0.0.1:${srv.address().port}${p}`, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }).on('error', reject));
  try { await fn(get); } finally { srv.close(); }
}

test('the root serves index.html and an svg says it is one', () => withServer(async get => {
  assert.equal((await get('/')).body, '<title>x</title>');
  assert.equal((await get('/icon.svg')).type, 'image/svg+xml');
  assert.equal((await get('/nope.css')).status, 404);
}));

test('a malformed percent-escape is a 400, not a dead server', () => withServer(async get => {
  // decodeURIComponent throws on this; uncaught, it took the whole process down.
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/')).status, 200, 'and the server is still up');
}));

test('a path that escapes dist/ is refused, even into a sibling that shares the prefix', () => {
  // Checked on the decoded path rather than over HTTP: the URL parser folds an
  // encoded ../ away before the handler sees it, so a request can only reach
  // this check by a route the parser leaves alone — an encoded backslash, on
  // Windows. The check still has to be right when it is reached.
  assert.equal(fileFor(root, '/icon.svg'), path.join(root, 'icon.svg'));
  assert.equal(fileFor(root, '/'), path.join(root, 'index.html'));
  assert.equal(fileFor(root, '/../../etc/passwd'), null);
  // startsWith(root) alone let this one through: dist-old starts with dist.
  assert.equal(fileFor(root, '/../dist-old/secret.txt'), null);
  if (process.platform === 'win32') assert.equal(fileFor(root, '/\\..\\dist-old\\secret.txt'), null);
});

test('and over the wire, nothing outside dist/ is ever served', () => withServer(async get => {
  for (const p of ['/%2e%2e/dist-old/secret.txt', '/%5C..%5Cdist-old%5Csecret.txt', '/..%2Fdist-old%2Fsecret.txt']) {
    const r = await get(p);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
    assert.notEqual(r.body, 'no', `${p} leaked the sibling's file`);
  }
}));
