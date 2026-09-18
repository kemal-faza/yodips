import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

const DEFAULT_THRESHOLD_BYTES = 1024;

type CompressionEncoding = 'br' | 'gzip';

function bodyBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, encoding);
  return Buffer.from(chunk as Uint8Array);
}

function qualityFor(
  values: Map<string, number>,
  encoding: CompressionEncoding,
): number {
  return values.get(encoding) ?? values.get('*') ?? 0;
}

function negotiateEncoding(
  header: string | undefined,
): CompressionEncoding | undefined {
  if (!header) return undefined;
  const values = new Map<string, number>();
  for (const item of header.split(',')) {
    const [name, ...parameters] = item.trim().toLowerCase().split(';');
    if (!name) continue;
    const qualityParameter = parameters.find((parameter) =>
      parameter.trim().startsWith('q='),
    );
    const quality = qualityParameter
      ? Number.parseFloat(qualityParameter.trim().slice(2))
      : 1;
    values.set(name, Number.isFinite(quality) ? Math.max(0, quality) : 0);
  }
  const brotliQuality = qualityFor(values, 'br');
  const gzipQuality = qualityFor(values, 'gzip');
  if (brotliQuality <= 0 && gzipQuality <= 0) return undefined;
  if (brotliQuality >= gzipQuality) return 'br';
  return 'gzip';
}

function isCompressibleContentType(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const type = value.split(';', 1)[0].trim().toLowerCase();
  return (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('javascript') ||
    type.includes('xml') ||
    type === 'image/svg+xml'
  );
}

function hasNoTransform(value: unknown): boolean {
  return (
    typeof value === 'string' && /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(value)
  );
}

function appendVary(value: unknown, token: string): string {
  const current = Array.isArray(value)
    ? value.map(String).join(',')
    : typeof value === 'string'
      ? value
      : '';
  const values = current
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === token.toLowerCase())) {
    values.push(token);
  }
  return values.join(', ');
}

function compressBody(
  encoding: CompressionEncoding,
  body: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, result: Buffer) =>
      error ? reject(error) : resolve(result);
    if (encoding === 'br') {
      brotliCompress(
        body,
        {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
          },
        },
        callback,
      );
    } else {
      gzip(body, callback);
    }
  });
}

function shouldCompress(
  req: Request,
  res: Response,
  bodyLength: number,
  threshold: number,
): CompressionEncoding | undefined {
  if (
    req.method === 'HEAD' ||
    res.statusCode === 204 ||
    res.statusCode === 304 ||
    bodyLength < threshold ||
    !isCompressibleContentType(res.getHeader('Content-Type')) ||
    res.getHeader('Content-Encoding') !== undefined ||
    hasNoTransform(res.getHeader('Cache-Control'))
  ) {
    return undefined;
  }
  return negotiateEncoding(req.headers['accept-encoding']);
}

/**
 * Compresses sufficiently large JSON/HTML responses using the client's best
 * supported Brotli or gzip coding. The response is buffered only until its
 * final size is known; non-compressible and undeclared streaming responses pass
 * through without buffering.
 */
export function responseCompression(
  options: { threshold?: number } = {},
): RequestHandler {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD_BYTES;

  return (req: Request, res: Response, next: NextFunction): void => {
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const chunks: Buffer[] = [];
    let passthrough = false;

    const flushPassthrough = (
      chunk?: unknown,
      encoding?: BufferEncoding,
    ): boolean => {
      for (const buffered of chunks.splice(0)) originalWrite(buffered);
      if (chunk !== undefined && chunk !== null) {
        originalWrite(bodyBuffer(chunk, encoding));
      }
      passthrough = true;
      return true;
    };

    (res as any).write = (
      chunk: unknown,
      encoding?: BufferEncoding | (() => void),
      callback?: () => void,
    ) => {
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      const contentType = res.getHeader('Content-Type');
      const knownNonCompressible =
        contentType === undefined ||
        !isCompressibleContentType(contentType) ||
        hasNoTransform(res.getHeader('Cache-Control'));
      if (passthrough || res.headersSent || knownNonCompressible) {
        const result = flushPassthrough(chunk, encoding as BufferEncoding);
        callback?.();
        return result;
      }
      if (chunk !== undefined && chunk !== null)
        chunks.push(bodyBuffer(chunk, encoding as BufferEncoding));
      callback?.();
      return true;
    };

    (res as any).end = (
      chunk?: unknown,
      encoding?: BufferEncoding | (() => void),
      callback?: () => void,
    ) => {
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      if (passthrough) {
        const result = originalEnd(
          chunk as any,
          encoding as any,
          callback as any,
        );
        return result;
      }
      if (chunk !== undefined && chunk !== null)
        chunks.push(bodyBuffer(chunk, encoding as BufferEncoding));
      const body = Buffer.concat(chunks);
      const selected = shouldCompress(req, res, body.length, threshold);
      if (!selected) {
        passthrough = true;
        return originalEnd(body, callback as any);
      }

      void compressBody(selected, body)
        .then((compressed) => {
          res.setHeader(
            'Vary',
            appendVary(res.getHeader('Vary'), 'Accept-Encoding'),
          );
          res.setHeader('Content-Encoding', selected);
          res.removeHeader('Content-Length');
          originalEnd(compressed, callback as any);
        })
        .catch(() => {
          // Compression is an optimization, never a response failure mode.
          passthrough = true;
          originalEnd(body, callback as any);
        });
      return res;
    };

    next();
  };
}
