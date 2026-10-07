export class HermesHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(body || statusText || `HTTP ${status}`);
    this.name = 'HermesHttpError';
    this.status = status;
    this.body = body;
  }
}

export interface HermesRequestInit extends RequestInit {
  /** Skip automatically appending the active PWA profile query parameter. */
  skipProfile?: boolean;
  /** Abort the request after this many milliseconds. Defaults to 15s. */
  timeoutMs?: number;
}

export interface Http {
  <T>(path: string, init?: HermesRequestInit): Promise<T>;
  setProfile(name: string | undefined): void;
}

export function makeHttp(baseUrl = '', profile?: string, origin = 'http://localhost'): Http {
  let currentProfile = profile;

  async function http<T>(path: string, init: HermesRequestInit = {}): Promise<T> {
    const { skipProfile, timeoutMs = 15_000, signal: upstreamSignal, ...fetchInit } = init;
    const url = new URL(`${baseUrl}${path}`, origin);
    if (currentProfile && !skipProfile && !url.searchParams.has('profile')) {
      url.searchParams.set('profile', currentProfile);
    }

    const headers = new Headers(fetchInit.headers);
    if (fetchInit.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const abortFromUpstream = (): void => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
    }
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(new Error('HTTP request timed out')), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        ...fetchInit,
        cache: 'no-store',
        credentials: 'include',
        headers,
        signal: controller.signal,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }

    if (!response.ok) {
      throw new HermesHttpError(response.status, response.statusText, await response.text());
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (url.pathname === '/auth/logout') return undefined as T;
    return (await response.json()) as T;
  }

  http.setProfile = (name: string | undefined): void => {
    currentProfile = name;
  };

  return http;
}
