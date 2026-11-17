// Gemini API (Google AI Studio 키) — life 앱(worker/solve.ts)과 같은 부르는 방식 · 같은 모델 고르기.
// 키는 Cloudflare 비밀값으로: 이름에 gemini 가 들어가면 찾는다 (GEMINI_API_KEY, GEMINI_KEY, Life_gemini_api_key …).

export interface Msg {
  role: string;
  content: string;
}

const GEM = 'https://generativelanguage.googleapis.com/v1beta';

/** 비밀값에서 Gemini 키 찾기: 이름(대소문자 · _ · - 무시)에 gemini 가 들어간 첫 글자 값 */
export function geminiKey(env: object): string | undefined {
  const e = env as Record<string, unknown>;
  const names = Object.keys(e).filter((k) => /gemini/i.test(k) && typeof e[k] === 'string' && (e[k] as string).trim());
  // 정해 둔 이름을 먼저
  const pref = ['GEMINI_API_KEY', 'GEMINI_KEY', 'Life_gemini_api_key'];
  names.sort((a, b) => (pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99));
  return names.length ? (e[names[0]] as string).trim() : undefined;
}

/** 글을 만드는 모델만, Flash → Flash Lite → Gemma 4 순서 (같은 줄에서는 새 판 · 정식판 먼저) */
export function geminiChain(json: unknown): string[] {
  const models = (json as { models?: { name?: unknown; supportedGenerationMethods?: unknown }[] })?.models ?? [];
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const ver = (n: string) => Number(n.match(/(?:gemini|gemma)-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const size = (n: string) => Number(n.match(/(\d+)b/)?.[1] ?? 0);
  const ok = models
    .map((m) => ({ name: s(m.name).replace(/^models\//, ''), gen: !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent') }))
    .filter((m) => m.gen && !/image|tts|live|audio|embedding|native|transcribe|robotics|computer|exp\b|-exp-/.test(m.name));
  const by = (re: RegExp, not?: RegExp) =>
    ok
      .filter((m) => re.test(m.name) && !(not && not.test(m.name)))
      .sort((a, b) => ver(b.name) - ver(a.name) || Number(/preview/.test(a.name)) - Number(/preview/.test(b.name)) || size(b.name) - size(a.name) || a.name.length - b.name.length)
      .map((m) => m.name);
  return [...by(/^gemini-.*flash/, /lite/), ...by(/^gemini-.*flash-lite/), ...by(/^gemma-4/)];
}

/** 목록을 못 받을 때 해 볼 이름 (life 앱이 쓰는 목록, 2026-10-30 AI Studio 화면 기준) */
export const GEMINI_KNOWN = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-it'];

/** Gemini 하루 한도가 다시 차는 날짜: 태평양 시간 자정 기준 (Google 문서) */
export const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now));

export async function geminiModels(key: string, f: typeof fetch = fetch): Promise<string[]> {
  const all: unknown[] = [];
  let page = '';
  for (let i = 0; i < 5; i++) {
    const res = await f(`${GEM}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) break;
    const j = (await res.json()) as { models?: unknown[]; nextPageToken?: string };
    all.push(...(j.models ?? []));
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  const chain = geminiChain({ models: all });
  return chain.length ? chain : GEMINI_KNOWN;
}

/** 우리 메시지(system · user …)를 Gemini 모양으로. Gemma 는 시스템 지시를 첫 질문 앞에 붙인다 */
export function geminiBody(messages: Msg[], model: string) {
  const gemma = model.startsWith('gemma');
  const sys = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  return {
    ...(sys && !gemma ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    contents: rest.map((m, i) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: gemma && i === 0 && sys ? `${sys}\n\n${m.content}` : m.content }] })),
    generationConfig: { temperature: 0.2 },
  };
}

export function readGemini(json: unknown): string {
  const parts = (json as { candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => p.thought !== true)
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

export class GeminiDayLimit extends Error {}

export async function askGemini(key: string, model: string, messages: Msg[], f: typeof fetch = fetch): Promise<string> {
  const res = await f(`${GEM}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(geminiBody(messages, model)) });
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const em = j?.error?.message ?? '';
  // 429 는 하루 한도일 수도, 분당 한도일 수도 있다: Google 이 보낸 말로 가른다
  if (res.status === 429) throw /per ?day|daily|PerDay/i.test(em) ? new GeminiDayLimit(`Gemini 하루 사용량을 다 썼어요 (${model})`) : new Error(`Gemini 분당 횟수에 걸렸어요 (${model})`);
  if (res.status === 404) throw new GeminiDayLimit(`Gemini 모델이 없어요 (${model})`);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${em}`.trim());
  const t = readGemini(j);
  if (!t) throw new Error(`Gemini 가 답을 주지 않았어요 (${model})`);
  return t;
}
