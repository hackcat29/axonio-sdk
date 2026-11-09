import { ClawDBTimeoutError, ClawDBUnavailableError, fromHttpResponse } from 'axonio-errors';
import type { ClawDBConfig, ClawDBSession } from 'axonio-types';

import { sleep } from './internal';
import type { Transport } from './types';

type RequestMeta = {
  headers?: Record<string, string>;
};

type TransportPayload<T> = T & {
  _meta?: RequestMeta;
};

export type ClientMiddleware = <TReq, TRes>(
  method: string,
  request: TReq,
  next: (method: string, request: TReq) => Promise<TRes>
) => Promise<TRes>;

interface RuntimeTransport extends Transport {
  mode: 'grpc' | 'grpc-web' | 'http';
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function composeMiddlewares(
  core: <TReq, TRes>(method: string, request: TReq) => Promise<TRes>,
  middlewares: ClientMiddleware[]
): <TReq, TRes>(method: string, request: TReq) => Promise<TRes> {
  return <TReq, TRes>(method: string, request: TReq) => {
    let next: (currentMethod: string, currentRequest: unknown) => Promise<unknown> = (currentMethod, currentRequest) =>
      core(currentMethod, currentRequest);

    for (const middleware of [...middlewares].reverse()) {
      const previous = next;
      next = (currentMethod, currentRequest) => middleware(currentMethod, currentRequest, previous);
    }

    return next(method, request) as Promise<TRes>;
  };
}

function extractMeta<T>(payload: TransportPayload<T>): { body: T; meta: RequestMeta } {
  const { _meta, ...body } = payload as TransportPayload<T> & Record<string, unknown>;
  return { body: body as T, meta: _meta ?? {} };
}

function normalizeMethodPath(method: string): string {
  return method.replace(/\./gu, '/');
}

export class TransportFactory {
  static create(config: Required<ClawDBConfig>, session: () => ClawDBSession | undefined = () => undefined): RuntimeTransport {
    const browser = isBrowserRuntime();
    const tls = config.endpoint.startsWith('https://') || config.tls;
    const mode: RuntimeTransport['mode'] = browser && config.endpoint.startsWith('http://') ? 'grpc-web' : tls ? 'grpc' : 'grpc';

    const core = async <TReq, TRes>(method: string, request: TReq): Promise<TRes> => {
      const { body, meta } = extractMeta(request as TransportPayload<TReq>);
      const endpoint = `${config.endpoint.replace(/\/$/u, '')}/${normalizeMethodPath(method)}`;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...meta.headers
      };

      if (config.apiKey) {
        headers['x-api-key'] = config.apiKey;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        const contentType = response.headers.get('content-type') ?? '';
        const responseBody = contentType.includes('application/json') ? await response.json() : await response.text();

        if (!response.ok) {
          throw fromHttpResponse(response.status, responseBody);
        }

        return responseBody as TRes;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new ClawDBTimeoutError(`Request to ${method} was aborted`, config.timeout, error);
        }

        if (error instanceof ClawDBTimeoutError) {
          throw error;
        }

        if (error instanceof Error && 'code' in error) {
          throw error;
        }

        throw new ClawDBUnavailableError(
          error instanceof Error ? error.message : `Unable to reach ClawDB endpoint for ${method}`,
          error
        );
      }
    };

    const request = composeMiddlewares(core, [
      TransportFactory.createRetryMiddleware(config),
      TransportFactory.createAuthMiddleware(session),
      TransportFactory.createTimeoutMiddleware(config.timeout)
    ]);

    return {
      mode,
      request,
      async *stream<TReq, TRes>(method: string, payload: TReq): AsyncIterable<TRes> {
        const response = await request<TReq, unknown>(method, payload);

        if (response != null && Symbol.asyncIterator in Object(response)) {
          for await (const item of response as AsyncIterable<TRes>) {
            yield item;
          }
          return;
        }

        if (Array.isArray(response)) {
          for (const item of response) {
            yield item as TRes;
          }
          return;
        }

        if (response != null) {
          yield response as TRes;
        }
      },
      close() {
        return undefined;
      }
    };
  }

  static createRetryMiddleware(_config: Required<ClawDBConfig>): ClientMiddleware {
    const maxAttempts = 3;

    return async <TReq, TRes>(method: string, request: TReq, next: (m: string, r: TReq) => Promise<TRes>) => {
      let attempt = 0;

      while (attempt < maxAttempts) {
        try {
          return await next(method, request);
        } catch (error) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : undefined;
          const message = error instanceof Error ? error.message : '';
          const unavailable = code === 'UNAVAILABLE' || code === '14' || /UNAVAILABLE/i.test(message);

          if (!unavailable || attempt === maxAttempts - 1) {
            throw error;
          }

          await sleep(100 * 2 ** attempt);
          attempt += 1;
        }
      }

      throw new ClawDBUnavailableError(`Failed to execute ${method}`);
    };
  }

  static createAuthMiddleware(session: () => ClawDBSession | undefined): ClientMiddleware {
    return async <TReq, TRes>(
      method: string,
      request: TReq,
      next: (m: string, r: TReq & { _meta?: RequestMeta }) => Promise<TRes>
    ) => {
      const token = session()?.token;
      const source = (request ?? {}) as Record<string, unknown>;
      const existingMeta = (source._meta ?? {}) as RequestMeta;

      return next(method, {
        ...source,
        _meta: {
          ...existingMeta,
          headers: {
            ...(existingMeta.headers ?? {}),
            ...(token ? { authorization: `Bearer ${token}` } : {})
          }
        }
      } as TReq & { _meta?: RequestMeta });
    };
  }

  static createTimeoutMiddleware(timeoutMs: number): ClientMiddleware {
    return async <TReq, TRes>(method: string, request: TReq, next: (m: string, r: TReq) => Promise<TRes>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<TRes>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ClawDBTimeoutError(`Request to ${method} exceeded ${timeoutMs}ms`, timeoutMs));
        }, timeoutMs);
      });

      try {
        return await Promise.race([next(method, request), timeoutPromise]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };
  }
}
