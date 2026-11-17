// 사이트 파일은 그대로 내보내고, /api/* 는 서재 서버(Durable Object 하나)로 넘긴다.
import { Library } from './library';

export { Library };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        const stub = env.LIBRARY.get(env.LIBRARY.idFromName('global'));
        const again = req.clone();
        try {
          return await stub.fetch(req);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/exceeded|limit|quota/i.test(msg)) throw e;
          console.error('library retry', msg);
          return await stub.fetch(again);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('library unavailable', msg);
        const quota = /exceeded|free tier|limit|quota/i.test(msg);
        return new Response(JSON.stringify({ error: quota ? '오늘 서버 무료 사용 한도를 다 써서 한국 시간 오전 9시까지 저장할 수 없어요.' : '서버에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.' }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
      }
    }
    return env.ASSETS.fetch(req);
  },
};
