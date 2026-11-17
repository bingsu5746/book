// 서버 부르기. 실패하면 서버가 준 한국어 오류를 그대로 던진다.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  // 바꾸는 요청은 서버가 JSON 만 받는다 (본문이 없는 지우기 요청도)
  const body = opts.body !== undefined ? opts.body : method !== 'GET' && method !== 'HEAD' ? {} : undefined;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('인터넷에 연결되어 있지 않아요.', 0);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status === 404 ? '서버 주소를 찾지 못했어요.' : '서버 오류가 났어요.', res.status);
    return res as unknown as T;
  }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('auth/')) onUnauthorized();
    throw new ApiError(data?.error ?? '요청을 처리하지 못했어요.', res.status);
  }
  return data as T;
}

/** 파일(바이트) 받기 */
export async function apiBytes(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    let msg = '파일을 받지 못했어요.';
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* 글이 아님 */
    }
    throw new ApiError(msg, res.status);
  }
  return res.arrayBuffer();
}
