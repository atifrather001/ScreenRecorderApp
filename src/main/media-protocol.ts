// `media://` protocol so the sandboxed renderer can stream local video files (with Range support).
import { protocol } from 'electron';
import { createReadStream, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { Readable } from 'stream';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, standard: true, secure: true, corsEnabled: true } },
  ]);
}

export function handleMediaProtocol(): void {
  protocol.handle('media', (request) => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const filePath = process.platform === 'win32' ? path : `/${path.replace(/^\/+/, '')}`;
    if (!existsSync(filePath)) return new Response('Not found', { status: 404 });
    const size = statSync(filePath).size;
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const range = request.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      if (m && !m[1] && m[2]) {
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Access-Control-Allow-Origin': '*',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  });
}
