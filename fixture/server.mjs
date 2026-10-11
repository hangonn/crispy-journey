// Serves the front page, the article pages, the saved-copy bundles and the reader's consent.
// No dependencies: `node fixture/server.mjs` (Node 18 or newer). Control panel: /control
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
const TEMPLATE_PATH = process.env.ARTICLE_TEMPLATE
  ? resolve(process.env.ARTICLE_TEMPLATE)
  : fileURLToPath(new URL('./article.html', import.meta.url));
const FRONT_PATH = fileURLToPath(new URL('./front.html', import.meta.url));

const SLOW_CHUNK_BYTES = 16 * 1024;
const SLOW_CHUNK_INTERVAL_MS = 100;
const LOG_LIMIT = 200;

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const SVG = 'image/svg+xml';
const TEXT = 'text/plain; charset=utf-8';

// Where each article appears on the front page. "More stories" arrives a moment after the page is ready.
const FRONT_SECTIONS = { top: ['1', '2', '3'], more: ['7', '8'], tests: ['4', '5', '6'] };

// Free NZZ articles, frozen and shortened for this exercise (fixture/articles.json). Their photos stay on the NZZ
// image CDN; the map is ours.
const ARTICLES = JSON.parse(readFileSync(fileURLToPath(new URL('./articles.json', import.meta.url)), 'utf8')).articles;

const photosOf = article => article.blocks.filter(block => block.type === 'figure');

// A saved copy is the page, the map, and the article's photos. The page refers to all of them relative to itself.
const ownFilesOf = () => ['index.html', 'media/map.svg'];

const MEDIA = {
  'map.svg': mapSvg(),
};

const NETWORK_MODES = ['normal', 'slow', 'unreachable'];
const FAULTS = ['off', 'cut-next', 'error-next', 'cut-always'];
// Every answer comes after a random delay, like a consent service on a real phone. 'unreliable' is the default:
// the reader has chosen, but now and then the answer fails. The other modes fix what it answers, to reproduce a case.
const CONSENT_MODES = ['unreliable', 'given', 'none', 'error', 'hang'];
const UNRELIABLE_ERROR_RATE = 1 / 6;
const CONSENT_DELAY_MAX_MS = 8000;

let consentSerial = 0;
let state = initialState();
const log = [];

function initialState() {
  return {
    tracking: [],
    events: [],
    eventIds: new Set(),
    // When /consent last answered with a consent string. Until then, nothing may reach the collector.
    consentServedAt: null,
    network: 'normal',
    fault: 'off',
    consentMode: 'unreliable',
    consent: newConsent(),
    revisions: {},
  };
}

function newConsent() {
  consentSerial += 1;

  return `cs${consentSerial}-${randomBytes(2).toString('hex')}`;
}

function note(line) {
  const stamped = `${new Date().toISOString().slice(11, 23)}  ${line}`;

  console.log(stamped);
  log.push(stamped);
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

const findArticle = id => ARTICLES.find(article => article.id === id);
const revisionOf = article => state.revisions[article.id] ?? 0;

// Opaque to clients: a different value means the content changed.
const versionOf = (article, revision) =>
  createHash('sha256').update(`${article.id}:${revision}`).digest('hex').slice(0, 8);

const originOf = request => `http://${request.headers.host ?? `localhost:${PORT}`}`;

const escapeHtml = text =>
  String(text).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);

// Reading time of the shortened text, the way teasers show it.
function minutesOf(article) {
  const text = article.short ? article.lead : article.blocks.filter(block => block.text).map(block => block.text).join(' ');

  return Math.max(1, Math.round(text.split(/\s+/).length / 200));
}

// The CDN scales on request: the teaser picture at another width.
const imageAt = (url, width) => (url ? url.replace(/([?&])width=\d+/, `$1width=${width}`) : null);

const CLOCK_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor"/></svg>';

const teaserMeta = article => `${escapeHtml(article.author)}<span class="time">${CLOCK_ICON}${minutesOf(article)} min</span>`;

const storyOf = article => ({
  id: article.id,
  kicker: article.kicker,
  title: article.title,
  author: article.author,
  minutes: minutesOf(article),
  image: article.image,
});

function creditOf(article) {
  const who = [article.author, article.published].filter(Boolean).map(escapeHtml).join(', ');

  return `<p class="credit">Text: NZZ${who ? `, ${who}` : ''}. Shortened for this exercise. <a href="${escapeHtml(article.source)}">Original on nzz.ch</a></p>`;
}

// The article text: paragraphs, the article's own pull-quote headings and photos, in their original order.
function renderBody(article, source) {
  if (article.short) {
    return `<div class="articlecomponent text" id="article-text">\n<p id="start">${escapeHtml(article.lead)}</p>\n</div>\n${creditOf(article)}`;
  }

  const { blocks } = article;
  const half = Math.floor(blocks.length / 2);
  let middle = blocks.findIndex((block, index) => index >= half && block.type === 'quote');
  if (middle === -1) middle = blocks.findIndex((block, index) => index >= half && block.type === 'p');

  let photo = 0;
  let paragraphs = 0;
  const parts = blocks.map((block, index) => {
    const id = index === 0 ? ' id="start"' : index === middle ? ' id="middle"' : '';

    if (block.type === 'quote') return `<h3${id}>${escapeHtml(block.text)}</h3>`;

    if (block.type === 'figure') {
      photo += 1;
      const src = source === 'saved' ? `media/photo-${photo}.jpg` : block.src;

      return `<img${id} class="figure" src="${escapeHtml(src)}" width="960" height="640" alt="${escapeHtml(block.alt)}" />`;
    }

    paragraphs += 1;
    const paragraph = `<p${id}>${escapeHtml(block.text)}</p>`;

    // The map arrives late, after the second paragraph, and pushes the rest of the text down.
    if (paragraphs === 2) return `${paragraph}\n<div id="late-slot"></div>`;

    // The ad needs the reader's consent; the page fills it at start.
    if (paragraphs === 4) return `${paragraph}\n<div class="ad-slot" id="ad-slot"></div>`;

    return paragraph;
  });

  return `<div class="articlecomponent text" id="article-text">\n${parts.join('\n')}\n</div>\n${creditOf(article)}`;
}

async function renderPage(article, revision, { source, media, origin }) {
  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const config = {
    id: article.id,
    kicker: article.kicker,
    title: article.title,
    // A brief is nothing but its lead, which is then the article text itself.
    lead: article.short ? '' : article.lead,
    revision,
    version: versionOf(article, revision),
    source,
    media,
    origin,
    ready: article.ready ?? 'auto',
    short: article.short === true,
    author: article.author,
    published: article.published,
    // "More from the newsroom" below the article draws from these.
    others: ARTICLES.filter(other => other.id !== article.id && !other.ready).map(storyOf),
  };
  const configScript = `<script>window.__ARTICLE__ = ${JSON.stringify(config).replace(/</g, '\\u003c')};</script>`;

  return template
    .replace('<!-- article-config -->', configScript)
    .replace('<!-- article-body -->', renderBody(article, source))
    .replace('{{title-2}}', escapeHtml(findArticle('2').title))
    .replace('{{title-3}}', escapeHtml(findArticle('3').title))
    .replace('{{image-2}}', escapeHtml(findArticle('2').image ?? ''))
    .replace('{{image-3}}', escapeHtml(findArticle('3').image ?? ''))
    .replace('{{meta-2}}', teaserMeta(findArticle('2')))
    .replace('{{meta-3}}', teaserMeta(findArticle('3')))
    .replaceAll('{{media}}', media);
}

async function renderFront(origin) {
  const template = await readFile(FRONT_PATH, 'utf8');
  const teaserOf = id => {
    const article = findArticle(id);

    return { ...storyOf(article), revision: revisionOf(article), lead: article.lead, large: imageAt(article.image, 960) };
  };
  const config = {
    media: '/media/',
    origin,
    top: FRONT_SECTIONS.top.map(teaserOf),
    more: FRONT_SECTIONS.more.map(teaserOf),
    tests: FRONT_SECTIONS.tests.map(teaserOf),
  };
  const configScript = `<script>window.__FRONT__ = ${JSON.stringify(config).replace(/</g, '\\u003c')};</script>`;

  return template.replace('<!-- front-config -->', configScript);
}

async function bundleFile(article, revision, path, origin) {
  if (path === 'index.html') return renderPage(article, revision, { source: 'saved', media: 'media/', origin });

  return MEDIA[path.slice('media/'.length)];
}

function writeChunk(response, chunk) {
  return new Promise(done => response.write(chunk, () => done()));
}

// Control-panel responses pass with `control: true`, so the panel keeps working whatever the network switch says.
async function send(response, status, type, body, { cutAt, control = false } = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const limit = cutAt ?? buffer.length;

  response.writeHead(status, { 'content-type': type, 'content-length': buffer.length, 'cache-control': 'no-store' });

  let offset = 0;

  while (offset < limit) {
    if (response.destroyed) return;

    // Switching the server to unreachable drops transfers that are under way.
    if (!control && state.network === 'unreachable') {
      response.socket?.destroy();

      return;
    }

    const isSlow = !control && state.network === 'slow';
    const chunkSize = isSlow ? SLOW_CHUNK_BYTES : limit;
    const end = Math.min(limit, offset + chunkSize);

    await writeChunk(response, buffer.subarray(offset, end));
    offset = end;

    if (isSlow && offset < limit) await sleep(SLOW_CHUNK_INTERVAL_MS);
  }

  if (cutAt !== undefined) {
    response.socket?.destroy();

    return;
  }

  response.end();
}

const notFound = response => send(response, 404, TEXT, 'Not found');

async function handleBundleFile(request, response, article, version, path) {
  // The photos of a saved copy come straight from the image CDN; only the page and the map are served here.
  if (!ownFilesOf().includes(path)) return notFound(response);

  // Files of older versions stay available, so a download that started before an update can finish.
  let revision = -1;
  for (let candidate = 0; candidate <= revisionOf(article); candidate += 1) {
    if (versionOf(article, candidate) === version) revision = candidate;
  }
  if (revision === -1) return notFound(response);

  const body = Buffer.from(await bundleFile(article, revision, path, originOf(request)));
  const type = path.endsWith('.svg') ? SVG : HTML;

  if (path === 'media/map.svg' && state.fault !== 'off') {
    const fault = state.fault;

    if (fault !== 'cut-always') state.fault = 'off';

    if (fault === 'error-next') {
      note('  ↳ answered 500 (server error, armed once)');

      return send(response, 500, HTML, '<!doctype html><title>500</title><h1>Internal Server Error</h1>');
    }

    const cutAt = Math.floor(body.length / 2);

    note(`  ↳ connection cut after ${cutAt} of ${body.length} bytes${fault === 'cut-always' ? ' (every time)' : ' (armed once)'}`);

    return send(response, 200, type, body, { cutAt });
  }

  return send(response, 200, type, body);
}

const hangingConsentRequests = new Set();

async function handleConsent(response) {
  if (state.consentMode === 'hang') {
    note('  ↳ consent: not answering');
    hangingConsentRequests.add(response);
    response.on('close', () => hangingConsentRequests.delete(response));

    return;
  }

  const unreliable = state.consentMode === 'unreliable';
  const delay = Math.round(Math.random() * CONSENT_DELAY_MAX_MS);

  await sleep(delay);
  if (response.destroyed) return;

  if (state.consentMode === 'error' || (unreliable && Math.random() < UNRELIABLE_ERROR_RATE)) {
    note(`  ↳ consent: 500 after ${delay} ms`);

    return send(response, 500, JSON_TYPE, JSON.stringify({ error: 'unavailable' }));
  }

  const consent = unreliable || state.consentMode === 'given' ? state.consent : null;
  if (consent !== null) state.consentServedAt = Date.now();

  note(`  ↳ consent: ${consent ?? 'null'} after ${delay} ms`);

  return send(response, 200, JSON_TYPE, JSON.stringify({ consent }));
}

const TRACKING_LIMIT = 60;

function recordTracking(entry) {
  state.tracking.push({ at: new Date().toISOString().slice(11, 19), ...entry });
  if (state.tracking.length > TRACKING_LIMIT) state.tracking.splice(0, state.tracking.length - TRACKING_LIMIT);
}

async function readJson(request) {
  try {
    return JSON.parse(await readBody(request));
  } catch {
    return null;
  }
}

const COLLECTOR_NAMESPACE = 'news-app';
const APP_CONTEXT_SCHEMA = 'iglu:com.example.news/app/jsonschema/1-0-0';
const PAGE_CONTEXT_SCHEMA = 'iglu:com.example.news/page/jsonschema/1-0-0';
const READ_SCHEMA = 'iglu:com.example.news/article_read/jsonschema/1-0-0';
const EVENT_KINDS = ['screen_view', 'self_describing', 'page_view'];
const EVENT_LIMIT = 80;

function describeEvent(item) {
  const event = item.event && typeof item.event === 'object' ? item.event : {};

  if (item.e === 'screen_view') return `screen view: ${event.name}${event.id ? ` ${event.id}` : ''}`;

  if (item.e === 'page_view') {
    const page = (item.contexts ?? []).find(context => context?.schema === PAGE_CONTEXT_SCHEMA)?.data;

    return page ? `page view: ${page.page}${page.articleId ? ` ${page.articleId}` : ''}, document ${page.document}` : `page view: ${event.pageUrl}`;
  }

  const name = String(event.schema ?? '?').replace(/^iglu:[^/]+\//, '').replace(/\/jsonschema.*$/, '');

  return `${name}: ${event.data?.articleId ?? JSON.stringify(event.data ?? {})}`;
}

// The tracker SDK's collector. Records every event and flags the ones that break the brief's rules.
async function handleCollect(request, response) {
  const body = await readJson(request);
  const valid =
    body &&
    typeof body.namespace === 'string' &&
    typeof body.appVersion === 'string' &&
    (body.platform === 'ios' || body.platform === 'android') &&
    Array.isArray(body.events) &&
    body.events.every(
      item => item && typeof item.eid === 'string' && EVENT_KINDS.includes(item.e) && ['app', 'webview'].includes(item.source),
    );

  if (!valid) {
    note('  ↳ collector: rejected, not a tracker batch');

    return send(response, 400, JSON_TYPE, JSON.stringify({ error: 'Not a tracker batch' }));
  }

  const beforeConsent = state.consentServedAt === null;

  for (const item of body.events) {
    const contexts = Array.isArray(item.contexts) ? item.contexts : [];
    const problems = [];

    if (beforeConsent) problems.push('sent before the reader had chosen');
    if (state.eventIds.has(item.eid)) problems.push('sent twice');
    if (body.namespace !== COLLECTOR_NAMESPACE) problems.push(`namespace "${body.namespace}"`);
    if (item.source === 'webview' && !contexts.some(context => context?.schema === APP_CONTEXT_SCHEMA)) {
      problems.push('no app context');
    }

    state.eventIds.add(item.eid);
    state.events.push({
      at: new Date().toISOString().slice(11, 19),
      source: item.source === 'webview' ? 'page' : 'app',
      platform: body.platform,
      event: describeEvent(item),
      problems,
    });

    if (item.e === 'self_describing' && item.event?.schema === READ_SCHEMA) {
      const suffix = problems.length ? ` ⚠ ${problems.join(', ')}` : '';
      recordTracking({ source: 'app', articleId: String(item.event.data?.articleId), event: `read${suffix}` });
    }
  }

  if (state.events.length > EVENT_LIMIT) state.events.splice(0, state.events.length - EVENT_LIMIT);

  note(`  ↳ collector: ${body.events.length} event(s) from ${body.platform} ${body.appVersion}${beforeConsent ? ' ⚠ before the reader had chosen' : ''}`);
  response.writeHead(204).end();
}

async function handlePageEvent(request, response) {
  const body = await readJson(request);

  if (body && body.event === 'end-of-text-seen' && typeof body.articleId === 'string') {
    note(`  ↳ page: article ${body.articleId}, end of text seen (document ${body.document})`);
    recordTracking({ source: 'page', articleId: body.articleId, event: 'end of text seen', document: body.document });
  }

  response.writeHead(204).end();
}

function controlState() {
  return {
    tracking: state.tracking.slice(-30),
    events: state.events.slice(-40),
    network: state.network,
    fault: state.fault,
    consentMode: state.consentMode,
    consent: state.consent,
    template: TEMPLATE_PATH,
    articles: ARTICLES.map(article => ({
      id: article.id,
      title: article.title,
      revision: revisionOf(article),
      version: versionOf(article, revisionOf(article)),
    })),
    log: log.slice(-40),
  };
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) chunks.push(chunk);

  return Buffer.concat(chunks).toString('utf8');
}

function applyControl(params) {
  const action = params.get('action');
  const value = params.get('value');

  switch (action) {
    case 'network':
      if (!NETWORK_MODES.includes(value)) return false;
      state.network = value;
      break;
    case 'fault':
      if (!FAULTS.includes(value)) return false;
      state.fault = value;
      break;
    case 'consent-mode':
      if (!CONSENT_MODES.includes(value)) return false;
      state.consentMode = value;
      break;
    case 'change-consent':
      state.consent = newConsent();
      break;
    case 'publish': {
      const article = findArticle(params.get('id') ?? '');
      if (!article) return false;
      state.revisions[article.id] = revisionOf(article) + 1;
      break;
    }
    case 'reset':
      hangingConsentRequests.forEach(response => response.destroy());
      state = initialState();
      break;
    default:
      return false;
  }

  note(`control: ${[...params].map(([key, entry]) => `${key}=${entry}`).join(' ')}`);

  return true;
}

async function handleControl(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/control') return send(response, 200, HTML, CONTROL_PAGE, { control: true });
  if (request.method === 'GET' && pathname === '/control/state.json') {
    return send(response, 200, JSON_TYPE, JSON.stringify(controlState()), { control: true });
  }

  if (request.method === 'POST' && pathname === '/control') {
    const accepted = applyControl(new URLSearchParams(await readBody(request)));

    return send(response, accepted ? 200 : 400, JSON_TYPE, JSON.stringify(controlState()), { control: true });
  }

  return send(response, 404, TEXT, 'Not found', { control: true });
}

async function handle(request, response) {
  const { pathname, search } = new URL(request.url ?? '/', 'http://fixture.local');

  if (pathname === '/control' || pathname.startsWith('/control/')) return handleControl(request, response, pathname);

  if (state.network === 'unreachable') {
    note(`${request.method} ${pathname}${search}  ↳ dropped (server unreachable)`);
    request.socket.destroy();

    return;
  }

  note(`${request.method} ${pathname}${search}`);

  if (request.method === 'POST' && pathname === '/collect') return handleCollect(request, response);
  if (request.method === 'POST' && pathname === '/page-events') return handlePageEvent(request, response);

  if (request.method !== 'GET') return send(response, 405, TEXT, 'Method not allowed');

  if (pathname === '/') {
    response.writeHead(302, { location: '/control' }).end();

    return;
  }

  if (pathname === '/front') return send(response, 200, HTML, await renderFront(originOf(request)));

  if (pathname === '/consent') return handleConsent(response);

  let match = pathname.match(/^\/article\/([\w-]+)$/);
  if (match) {
    const article = findArticle(match[1]);
    if (!article) return notFound(response);

    const page = await renderPage(article, revisionOf(article), {
      source: 'online',
      media: '/media/',
      origin: originOf(request),
    });

    return send(response, 200, HTML, page);
  }

  match = pathname.match(/^\/media\/([\w-]+\.svg)$/);
  if (match) return MEDIA[match[1]] ? send(response, 200, SVG, MEDIA[match[1]]) : notFound(response);

  match = pathname.match(/^\/bundle\/([\w-]+)\/manifest\.json$/);
  if (match) {
    const article = findArticle(match[1]);
    if (!article) return notFound(response);

    const revision = revisionOf(article);
    const version = versionOf(article, revision);
    const own = await Promise.all(
      ownFilesOf().map(async path => ({
        path,
        url: `/bundle/${article.id}/v/${version}/${path}`,
        bytes: Buffer.byteLength(await bundleFile(article, revision, path, originOf(request))),
      })),
    );
    const photos = photosOf(article).map((photo, index) => ({
      path: `media/photo-${index + 1}.jpg`,
      url: photo.src,
      bytes: photo.bytes,
    }));
    const files = [own[0], ...photos, ...own.slice(1)];

    return send(response, 200, JSON_TYPE, JSON.stringify({ articleId: article.id, title: article.title, version, files }, null, 2));
  }

  match = pathname.match(/^\/bundle\/([\w-]+)\/v\/([\w-]+)\/(.+)$/);
  if (match) {
    const article = findArticle(match[1]);

    return article ? handleBundleFile(request, response, article, match[2], match[3]) : notFound(response);
  }

  return notFound(response);
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    note(`  ↳ server error: ${error.message}`);
    if (!response.headersSent) response.writeHead(500).end();
    else response.destroy();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lanAddresses = Object.values(networkInterfaces())
    .flat()
    .filter(address => address && address.family === 'IPv4' && !address.internal)
    .map(address => address.address);

  console.log(`Article page       ${TEMPLATE_PATH}`);
  console.log(`Control panel      http://localhost:${PORT}/control`);
  console.log('Front page, at the address that fits where the app runs:');
  console.log(`  iOS simulator      http://localhost:${PORT}/front`);
  console.log(`  Android emulator   http://10.0.2.2:${PORT}/front`);
  lanAddresses.forEach(address => console.log(`  Device on Wi-Fi    http://${address}:${PORT}/front`));
});

// Small seeded generator so the media files are identical on every run.
function seeded(seed) {
  let value = seed >>> 0;

  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;

    return value / 4294967296;
  };
}

// Large on purpose, so a download takes a while on a slow connection.
function mapSvg() {
  const random = seeded(7);
  const lines = [];

  for (let index = 0; index < 3000; index += 1) {
    let x = random() * 800;
    let y = random() * 600;
    const points = [];

    for (let step = 0; step < 8; step += 1) {
      x = Math.max(0, Math.min(800, x + (random() - 0.5) * 40));
      y = Math.max(0, Math.min(600, y + (random() - 0.5) * 40));
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    const shade = 120 + Math.floor(random() * 80);

    lines.push(`  <polyline points="${points.join(' ')}" stroke="rgb(${shade},${shade + 20},${shade + 40})" fill="none"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#e8edf2"/>
${lines.join('\n')}
</svg>
`;
}

const CONTROL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixture control</title>
<style>
  :root {
    --bg: #f6f7f9; --text: #16181d; --card: #ffffff; --line: #dfe3e9; --muted: #555b66; --button: #ffffff;
    --button-line: #b8c0cc; --active: #16181d; --active-text: #ffffff; --row: #eef0f3; --log: #16181d; --log-text: #e8eaee;
    color-scheme: light;
  }
  html.dark {
    --bg: #0e0f12; --text: #e8eaee; --card: #17191e; --line: #2a2e36; --muted: #a0a6b0; --button: #1f2229;
    --button-line: #3a3f4a; --active: #e8eaee; --active-text: #16181d; --row: #23262d; --log: #000000; --log-text: #e8eaee;
    color-scheme: dark;
  }
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 16px; color: var(--text); background: var(--bg); }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  h1 { font-size: 18px; margin: 0; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  p { margin: 0 0 8px; color: var(--muted); }
  button { font: inherit; padding: 6px 10px; margin: 0 6px 6px 0; border: 1px solid var(--button-line); border-radius: 6px; background: var(--button); color: var(--text); cursor: pointer; }
  button.active { background: var(--active); color: var(--active-text); border-color: var(--active); }
  header button { margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--row); }
  code, pre { font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; }
  pre { background: var(--log); color: var(--log-text); padding: 10px; border-radius: 6px; overflow-x: auto; max-height: 360px; margin: 0; }
</style>
<script>
  // Dark unless the viewer switched to light; the choice stays in this browser.
  (function () {
    var light = false;
    try {
      light = localStorage.getItem('panel-theme') === 'light';
    } catch (error) {}
    if (!light) document.documentElement.classList.add('dark');
  })();
</script>
</head>
<body>
<header>
  <h1>Fixture control</h1>
  <button id="theme-toggle" type="button"></button>
</header>

<section>
  <h2>Network</h2>
  <p>Unreachable drops every connection, including transfers already under way. The control panel keeps working.</p>
  <div data-group="network">
    <button data-action="network" data-value="normal">Normal</button>
    <button data-action="network" data-value="slow">Slow</button>
    <button data-action="network" data-value="unreachable">Unreachable</button>
  </div>
</section>

<section>
  <h2>Saved-copy downloads</h2>
  <p>Faults hit the download of <code>media/map.svg</code>, the largest file in a saved copy.</p>
  <div data-group="fault">
    <button data-action="fault" data-value="off">No faults</button>
    <button data-action="fault" data-value="cut-next">Cut off the next one midway</button>
    <button data-action="fault" data-value="error-next">Answer the next one with 500</button>
    <button data-action="fault" data-value="cut-always">Cut off every one midway</button>
  </div>
</section>

<section>
  <h2>Reader's consent</h2>
  <p>Current consent string: <code id="consent"></code></p>
  <div data-group="consentMode">
    <button data-action="consent-mode" data-value="unreliable">Like a real phone: sometimes fails</button>
    <button data-action="consent-mode" data-value="given">Reader has chosen</button>
    <button data-action="consent-mode" data-value="none">Reader has not chosen yet</button>
    <button data-action="consent-mode" data-value="error">Answer with 500</button>
    <button data-action="consent-mode" data-value="hang">Never answer</button>
  </div>
  <p>Every answer comes after a random delay of up to eight seconds; the log shows each one. The server starts like a real phone. The other modes fix what it answers, so you can reproduce a case.</p>
  <button data-action="change-consent">Reader changes their choice</button>
</section>

<section>
  <h2>Articles</h2>
  <table>
    <thead><tr><th>Id</th><th>Title</th><th>Revision</th><th>Version</th><th></th></tr></thead>
    <tbody id="articles"></tbody>
  </table>
</section>

<section>
  <h2>Reading</h2>
  <p>When the app's tracker reported an article read, next to when the page itself first saw the end of the article text. Saved copies cannot report to the page's server, so only the app's side shows for them.</p>
  <table>
    <thead><tr><th>Time</th><th>From</th><th>Article</th><th>Event</th></tr></thead>
    <tbody id="tracking"></tbody>
  </table>
</section>

<section>
  <h2>Tracking</h2>
  <p>Every event that reached the collector, newest first: the app's own and the pages' (handed over by the app). ⚠ marks events that break the brief's rules.</p>
  <table>
    <thead><tr><th>Time</th><th>From</th><th>Platform</th><th>Event</th><th>Problems</th></tr></thead>
    <tbody id="events"></tbody>
  </table>
</section>

<section>
  <h2>Requests</h2>
  <pre id="log"></pre>
  <p style="margin-top: 8px"><button data-action="reset">Reset everything</button></p>
</section>

<script>
  var current = null;

  function render(state) {
    current = state;
    document.querySelectorAll('[data-group]').forEach(function (group) {
      var selected = String(state[group.dataset.group]);
      group.querySelectorAll('button').forEach(function (button) {
        button.classList.toggle('active', button.dataset.value === selected);
      });
    });
    document.getElementById('consent').textContent = state.consent;
    document.getElementById('articles').innerHTML = state.articles.map(function (article) {
      return '<tr><td>' + article.id + '</td><td>' + article.title + '</td><td>' + article.revision +
        '</td><td><code>' + article.version + '</code></td><td><button data-action="publish" data-id="' + article.id +
        '">Publish a new version</button></td></tr>';
    }).join('');
    document.getElementById('log').textContent = state.log.slice().reverse().join('\\n');
    document.getElementById('tracking').innerHTML = state.tracking.slice().reverse().map(function (entry) {
      return '<tr><td><code>' + entry.at + '</code></td><td>' + entry.source + '</td><td>' + entry.articleId +
        '</td><td>' + entry.event + (entry.document ? ' (document ' + entry.document + ')' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="4">Nothing yet</td></tr>';
    document.getElementById('events').innerHTML = state.events.slice().reverse().map(function (entry) {
      return '<tr><td><code>' + entry.at + '</code></td><td>' + entry.source + '</td><td>' + entry.platform + '</td><td>' +
        escapeText(entry.event) + '</td><td>' + (entry.problems.length ? '⚠ ' + escapeText(entry.problems.join(', ')) : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="5">Nothing yet</td></tr>';
  }

  var themeToggle = document.getElementById('theme-toggle');

  function showThemeToggle() {
    themeToggle.textContent = document.documentElement.classList.contains('dark') ? 'Light mode' : 'Dark mode';
  }

  themeToggle.addEventListener('click', function () {
    var dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('panel-theme', dark ? 'dark' : 'light');
    } catch (error) {}
    showThemeToggle();
  });
  showThemeToggle();

  function escapeText(text) {
    return String(text).replace(/[&<>"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character];
    });
  }

  function refresh() {
    fetch('/control/state.json').then(function (response) { return response.json(); }).then(render).catch(function () {});
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;

    var body = new URLSearchParams({ action: button.dataset.action });
    if (button.dataset.value !== undefined) body.set('value', button.dataset.value);
    if (button.dataset.id !== undefined) body.set('id', button.dataset.id);

    fetch('/control', { method: 'POST', body: body }).then(function (response) { return response.json(); }).then(render);
  });

  refresh();
  setInterval(refresh, 1000);
</script>
</body>
</html>
`;
