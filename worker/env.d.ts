// wrangler types 가 만들지 않는 비밀값 (Cloudflare 대시보드 → book → Settings → Variables and Secrets)
interface Env {
  /** 가입할 때 넣어야 하는 초대 코드. 없으면 가입이 닫힌다 */
  INVITE_CODE?: string;
}
interface Env {
  /** 개발용: '1' 이면 Workers AI 대신 가짜 답 (wrangler dev 에서 분석집 흐름을 시험할 때만) */
  FAKE_AI?: string;
}
