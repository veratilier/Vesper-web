import { authorizeApp } from '@/lib/bridge-auth';
import { corsHeaders } from '@/lib/cors';
import { memoryScopeFromRequest, type MemoryScope } from '@/lib/memory';

export class APIError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export type AppContext = {
  request: Request;
  url: URL;
  requestId: string;
  scope(): Promise<MemoryScope>;
  json(value: unknown, status?: number): Response;
};
type RouteOptions = { service: string; methods: string[]; errorMessage: string; errorStatus?: number };
type Dependencies = { authorize: typeof authorizeApp; scope: typeof memoryScopeFromRequest; log: (entry: object) => void };
const defaults: Dependencies = { authorize: authorizeApp, scope: memoryScopeFromRequest, log: entry => console.log(JSON.stringify(entry)) };

/** Authentication and response policy are transport concerns, never business/model logic. */
export function appRoute(options: RouteOptions, handler: (context: AppContext) => Promise<Response>, dependencies: Dependencies = defaults) {
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID(), started = Date.now();
    let scope: Promise<MemoryScope> | undefined;
    const context: AppContext = {
      request, url: new URL(request.url), requestId,
      scope: () => scope ??= dependencies.scope(request),
      json(value, status = 200) {
        const headers = corsHeaders(request);
        headers.set('cache-control', 'no-store'); headers.set('x-vesper-request-id', requestId);
        return Response.json(value, { status, headers });
      },
    };
    let response: Response;
    try {
      if (!await dependencies.authorize(request)) response = context.json({ error: 'Device not paired' }, 401);
      else if (!options.methods.includes(request.method)) response = context.json({ error: 'Method not allowed' }, 405);
      else response = await handler(context);
    } catch (error) {
      const storage = error instanceof Error && /\b(?:D1_ERROR|SQLITE_|database is locked|database unavailable)/i.test(error.message);
      const status = error instanceof APIError ? error.status : storage ? 503 : error instanceof SyntaxError ? 400 : options.errorStatus ?? 400;
      const message = storage ? 'Storage unavailable; operation not confirmed' : error instanceof SyntaxError ? 'Invalid request body' : status >= 500 ? options.errorMessage : error instanceof Error ? error.message : options.errorMessage;
      response = context.json({ error: message }, status);
    }
    // No URL, query, credential, message, model input or exception contents enter logs.
    dependencies.log({ event: 'api_request', service: options.service, method: request.method, status: response.status, requestId, elapsedMs: Date.now() - started });
    return response;
  };
}
