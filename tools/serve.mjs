#!/usr/bin/env node
// Minimal static file server for dist/, so you do not need Python or a CDN.
//   node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'dist');
export const DEFAULT_PORT = 8000;

/**
 * `npm run serve` forwards anything typed after it, so a stray word from a
 * pasted command line arrives here as argv[2]. parseInt turned that into a NaN
 * port and the server died on a RangeError about sockets, which tells you
 * nothing about what you actually did wrong. Ignore what we cannot read, and
 * say so.
 */
export function readPort(arg, warn = console.error) {
  if (arg === undefined || String(arg).trim() === '') return DEFAULT_PORT;
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 0 && n < 65536) return n;
  warn(`ignoring "${arg}" — that is not a port number; using ${DEFAULT_PORT}.`);
  return DEFAULT_PORT;
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!path.resolve(file).startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});

// Only read argv and listen when run directly, so importing this to test the
// argument handling neither parses a test runner's argv nor holds a port.
// pathToFileURL, not a `file://` template — a Windows path is backslashed and
// would never match, which has bitten this repo before.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = readPort(process.argv[2]);
  srv.on('error', err => {
    // The other thing people hit: a server still running from a previous go.
    if (err.code === 'EADDRINUSE')
      console.error(`port ${PORT} is already in use — something else is serving it. `
                  + 'Stop that, or pick another:  node tools/serve.mjs 8001');
    else if (err.code === 'EACCES')
      console.error(`not allowed to listen on port ${PORT} — try one above 1024:  node tools/serve.mjs 8080`);
    else console.error(err.message);
    process.exit(1);
  });
  srv.listen(PORT, () => console.log(`serving dist/ on http://localhost:${PORT}`));
}
