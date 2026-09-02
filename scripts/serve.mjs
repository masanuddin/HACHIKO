/**
 * Minimal static server for the AI debug harness.
 *
 * getUserMedia requires a secure context; http://localhost counts as one, so
 * plain HTTP is fine here. Cross-origin isolation headers are set because
 * MediaPipe's threaded WASM build wants SharedArrayBuffer.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.map': 'application/json',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let rel = urlPath === '/' ? '/public/index.html' : urlPath;

    // Serve /src/** and /tools/** directly so the debug page imports the real
    // modules (AI core and debug/telemetry tools) rather than copies.
    const passthrough = ['/src/', '/tools/', '/public/'];
    if (!passthrough.some((prefix) => rel.startsWith(prefix))) {
      rel = join('/public', rel);
    }
    const filePath = normalize(join(root, rel));
    if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`HACHIKO AI debug harness: http://localhost:${PORT}`);
});
