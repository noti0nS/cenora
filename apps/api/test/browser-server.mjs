import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.test'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps/api/src/index.ts')],
  outfile: path.join(root, '.test/browser-worker.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: '127.0.0.1',
    port: 0,
    modules: true,
    scriptPath: path.join(root, '.test/browser-worker.mjs'),
    compatibilityDate: '2026-10-11',
    d1Databases: { DB: '22222222-2222-4222-8222-222222222222' },
    bindings: { ENVIRONMENT: 'development' },
  }),
);
await mf.ready;
const db = await mf.getD1Database('DB');
const migrations = path.join(root, 'apps/api/migrations');
for (const migration of (await readdir(migrations))
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  const statements = (await readFile(path.join(migrations, migration), 'utf8'))
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await db.batch(statements.map((statement) => db.prepare(statement)));
}
// A small local static host models the CDN; /api requests execute in the real Worker runtime.
// Keeping assets out of Miniflare also avoids Windows directory locks during subsequent builds.
const assets = path.join(root, 'apps/web/out');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:8788');
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await mf.dispatchFetch(url.toString(), {
        method: request.method,
        headers: request.headers,
        ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      response.statusCode = result.status;
      result.headers.forEach((value, key) => {
        if (key !== 'set-cookie') response.setHeader(key, value);
      });
      const cookies = result.headers.getSetCookie();
      if (cookies.length) response.setHeader('Set-Cookie', cookies);
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    const filename = path.resolve(
      assets,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!filename.startsWith(assets + path.sep)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const bytes = await readFile(filename);
    response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve) => server.listen(8788, '127.0.0.1', resolve));
console.log('Isolated browser test server ready on http://127.0.0.1:8788');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    server.close();
    await mf.dispose();
    process.exit(0);
  });
