import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export type Ctx = {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
};
type Handler = (ctx: Ctx) => unknown;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const MAX_BODY = 64 * 1024;

/** A small JSON router: routes like `/v1/rides/:id/cancel`, handlers return the response body or throw HttpError. */
export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' + path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)')) + '$',
    );
    this.routes.push({ method, pattern, keys, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204);

    const url = new URL(req.url ?? '/', 'http://local');
    const matches = this.routes.filter((r) => r.pattern.test(url.pathname));
    const route = matches.find((r) => r.method === req.method);
    try {
      if (!route) throw matches.length ? new HttpError(405, 'method_not_allowed', 'Method not allowed') : notFound();
      const m = route.pattern.exec(url.pathname)!;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = req.method === 'GET' ? undefined : await readJson(req);
      const result = await route.handler({ req, params, query: url.searchParams, body });
      send(res, result === undefined ? 204 : 200, result);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      send(res, 500, { error: 'internal', message: 'Something went wrong' });
    }
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Request body is too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('Body must be JSON');
  }
}

export function bearer(req: IncomingMessage) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}
