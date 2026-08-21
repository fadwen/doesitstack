// The dev server's argument handling.
//
// `npm run serve` forwards whatever you typed after it, so this gets fed odd
// things — a stray arrow from a pasted command line, a URL, an empty string.
// None of that should be a crash, and none of it should be a RangeError about
// sockets, which is what it used to be.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readPort, DEFAULT_PORT } from '../tools/serve.mjs';

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

test('importing the server neither reads argv nor holds a port', () => {
  // Both are guarded behind a direct-run check so this test file can exist at
  // all. If that guard goes, `npm test` warns about the test runner's own argv
  // and then hangs on port 8000 rather than failing cleanly.
  assert.equal(typeof readPort, 'function');
});
