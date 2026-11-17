// 미국 서부에 두는 작은 중계 서버 (Durable Object) — life 앱과 같은 방식.
// Gemini 는 요청이 나가는 곳이 지원 지역이 아니면 「User location is not supported」 로 거절하는데,
// 서재 서버(Library)는 그런 곳에 놓일 수 있어서 Gemini 요청만 여기를 거쳐 보낸다.
// 바인딩으로만 부를 수 있고(밖에서 주소로 못 옴), 받은 요청을 그대로 보내고 답을 그대로 돌려준다.
import { DurableObject } from 'cloudflare:workers';

export class Relay extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('not allowed', { status: 403 });
    return fetch(new Request(url.toString(), req));
  }
}

/** 미국 서부에 둔 중계 서버로 보내는 fetch (바인딩이 없으면 그냥 fetch) */
export function relayFetch(ns: DurableObjectNamespace<Relay> | undefined): typeof fetch {
  if (!ns) return fetch;
  const stub = ns.get(ns.idFromName('gemini-us-west'), { locationHint: 'wnam' });
  return ((input: RequestInfo | URL, init?: RequestInit) => stub.fetch(new Request(input as RequestInfo, init))) as typeof fetch;
}
