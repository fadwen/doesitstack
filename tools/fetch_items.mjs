#!/usr/bin/env node
// Fetch the SoDeq item dump, but only when it has actually changed.
//
//   node tools/fetch_items.mjs            download if newer, otherwise skip
//   node tools/fetch_items.mjs --force    download regardless
//   node tools/fetch_items.mjs --url ...  point at a mirror
//
// This is the ONLY part of the toolchain that touches the network, and it is a
// separate command from the build on purpose: `npm run build` stays offline and
// deterministic, so CI never depends on a third party being up and two builds
// from the same inputs produce the same dist.
//
// Writes vendor/items.txt (gitignored) and vendor/.fetch-state.json.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { arg } from './eqdir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

export const DEFAULT_URL = 'https://items.sodeq.org/downloads/items.txt.gz';
const VENDOR = path.join(ROOT, 'vendor');
const MAX_REDIRECTS = 3;

/** One request, following redirects, with the conditional headers applied. */
function request(url, headers, redirectsLeft = MAX_REDIRECTS) {
  // http as well as https so a mirror — or a test — can be pointed at.
  const mod = new URL(url).protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers }, res => {
      const { statusCode: code, headers: h } = res;
      if (code >= 300 && code < 400 && h.location) {
        res.resume();
        if (!redirectsLeft) return reject(new Error(`too many redirects from ${url}`));
        return resolve(request(new URL(h.location, url).href, headers, redirectsLeft - 1));
      }
      resolve({ code, headers: h, body: res, url });
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => req.destroy(new Error(`timed out fetching ${url}`)));
  });
}

export async function fetchItems({ url = DEFAULT_URL, force = false, log = console.log, dir = VENDOR } = {}) {
  const OUT = path.join(dir, 'items.txt');
  const STATE = path.join(dir, '.fetch-state.json');
  const readState = () => {
    try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
  };
  const state = readState();
  const headers = { 'accept-encoding': 'identity', 'user-agent': 'does-it-stack build script' };

  // Conditional request. If the server honours it we get a 304 and never
  // transfer the ~8 MB. If it ignores the headers we just download as normal —
  // correctness does not depend on it, only bandwidth.
  const have = fs.existsSync(OUT);
  if (!force && have) {
    if (state.etag) headers['if-none-match'] = state.etag;
    if (state.lastModified) headers['if-modified-since'] = state.lastModified;
  }

  const res = await request(url, headers);

  if (res.code === 304) {
    res.body.resume();
    log(`items: unchanged since ${state.lastModified || state.etag} — skipped download`);
    return { skipped: true, ...state };
  }
  if (res.code !== 200) {
    res.body.resume();
    throw new Error(`${url} returned HTTP ${res.code}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  // Unpack to a temp file and rename, so a connection that drops halfway cannot
  // leave a truncated items.txt that parses cleanly and tags the wrong things.
  const tmp = OUT + '.part';
  try {
    await pipeline(res.body, zlib.createGunzip(), fs.createWriteStream(tmp));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.renameSync(tmp, OUT);

  const next = {
    url,
    etag: res.headers.etag || null,
    lastModified: res.headers['last-modified'] || null,
    fetched: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    bytes: fs.statSync(OUT).size,
  };
  fs.writeFileSync(STATE, JSON.stringify(next, null, 2) + '\n');
  log(`items: downloaded ${(next.bytes / 1e6).toFixed(0)} MB -> ${path.relative(ROOT, OUT)}`);
  if (!next.etag && !next.lastModified)
    log('items: server sent no ETag or Last-Modified — every fetch will re-download.');
  return { skipped: false, ...next };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchItems({ url: arg('url', DEFAULT_URL), force: process.argv.includes('--force') })
    .catch(err => {
      // A missing or unreachable dump is not fatal: the build degrades to no
      // item tags. Say so clearly and exit non-zero so a script can react.
      console.error(`items: fetch failed — ${err.message}`);
      console.error('items: the build will still run, just without item tags.');
      process.exit(1);
    });
}
