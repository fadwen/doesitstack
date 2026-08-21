// Page metadata: what a crawler and a link preview see.
//
// This is easy to half-do and impossible to notice from inside a browser, so
// the checks are here rather than left to a manual look.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = f => readFile(new URL(f, root), 'utf8');
const PAGES = ['web/index.html', 'web/set.html'];

test('every page has a distinct title and description', async () => {
  const seen = { titles: new Set(), descs: new Set() };
  for (const f of PAGES) {
    const s = await read(f);
    const title = /<title>([^<]+)<\/title>/.exec(s)?.[1];
    const desc = /<meta name="description" content="([^"]+)">/.exec(s)?.[1];
    assert.ok(title, `${f} needs a title`);
    assert.ok(desc, `${f} needs a description`);
    // Search results truncate past roughly this, and a description that is only
    // a truncated title tells a searcher nothing.
    assert.ok(desc.length > 60 && desc.length < 200, `${f} description is ${desc.length} chars`);
    seen.titles.add(title); seen.descs.add(desc);
  }
  assert.equal(seen.titles.size, PAGES.length, 'two pages sharing a title compete with each other');
  assert.equal(seen.descs.size, PAGES.length);
});

test('every page carries share-card and canonical tags', async () => {
  for (const f of PAGES) {
    const s = await read(f);
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type',
                       'twitter:card', 'twitter:image'])
      assert.match(s, new RegExp(`"${tag}"`), `${f} is missing ${tag}`);
    assert.match(s, /<link rel="canonical"/, `${f} needs a canonical link`);
    assert.match(s, /"summary_large_image"/, `${f} should use the large card`);
  }
});

test('the address is a placeholder, never a hardcoded one', async () => {
  // A fork must not advertise this repo's URL as its own; build.mjs fills these
  // in from the git remote, or drops the lines when there is no remote.
  for (const f of [...PAGES, 'web/robots.txt', 'web/sitemap.xml']) {
    const s = await read(f);
    assert.match(s, /\{\{SITE_URL\}\}/, `${f} should use the placeholder`);
    assert.doesNotMatch(s, /fadwen\.github\.io/, `${f} must not hardcode an address`);
  }
});

test('the structured data is valid JSON and says what the site is', async () => {
  for (const f of PAGES) {
    const s = await read(f);
    const raw = /<script type="application\/ld\+json">(.+?)<\/script>/s.exec(s)?.[1];
    assert.ok(raw, `${f} needs structured data`);
    // The placeholder is not valid JSON until the build fills it, so stand in
    // for it exactly as the build would.
    const ld = JSON.parse(raw.replaceAll('{{SITE_URL}}', 'https://example.test/'));
    assert.equal(ld['@type'], 'WebApplication');
    assert.equal(ld.isAccessibleForFree, true);
    assert.equal(ld.about.name, 'EverQuest');
    assert.ok(ld.name && ld.description);
  }
});

test('the structured-data block stays on one line', async () => {
  // build.mjs drops whole lines containing the placeholder when there is no
  // remote. Split across lines, that would leave a fragment of broken JSON.
  for (const f of PAGES) {
    const line = (await read(f)).split('\n').find(l => l.includes('application/ld+json'));
    assert.ok(line.includes('</script>'), `${f} must keep its JSON-LD on a single line`);
  }
});

test('robots allows crawling and points at the sitemap', async () => {
  const s = await read('web/robots.txt');
  assert.match(s, /^User-agent: \*$/m);
  assert.match(s, /^Allow: \/$/m);
  assert.match(s, /^Sitemap: \{\{SITE_URL\}\}sitemap\.xml$/m);
});

test('the sitemap lists every page', async () => {
  const s = await read('web/sitemap.xml');
  for (const page of ['index.html', 'set.html'])
    assert.match(s, new RegExp(`<loc>\\{\\{SITE_URL\\}\\}${page}</loc>`), `sitemap is missing ${page}`);
});
