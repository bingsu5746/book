// 줄거리 요약 (Cloudflare Workers AI). life 앱과 같은 모델 · 같은 부르는 방식.
// 원고에 있는 일만 적게 하고(지어내지 않기), 평가 · 해석은 하지 않게 한다.
export const MODEL = '@cf/openai/gpt-oss-120b';
export const FALLBACK = '@cf/google/gemma-4-26b-a4b-it';
/** 한 번에 보내는 원고 최대 글자 (길면 앞 · 뒤를 남기고 가운데를 줄인다) */
export const MAX_INPUT = 9000;

export function clip(body: string, max = MAX_INPUT): { text: string; clipped: boolean } {
  const t = body.replace(/%%[\s\S]*?%%/g, '').replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, a, b) => b ?? a).trim();
  if (t.length <= max) return { text: t, clipped: false };
  const head = Math.floor(max * 0.7);
  return { text: `${t.slice(0, head)}\n\n(…중간 생략…)\n\n${t.slice(t.length - (max - head))}`, clipped: true };
}

export function synopsisMessages(title: string, body: string) {
  const { text } = clip(body);
  return [
    {
      role: 'system',
      content:
        '너는 소설 원고의 장 줄거리를 정리하는 편집자다. 주어진 원고에 실제로 쓰인 사건만 2~4문장의 한국어 평서문(-다)으로 요약한다. 원고에 없는 내용, 해석, 평가, 앞으로의 전개 추측은 쓰지 않는다. 인물 이름은 원고에 나온 그대로 쓴다. 제목이나 머리말 없이 요약 문장만 쓴다.',
    },
    { role: 'user', content: `장 제목: ${title || '(없음)'}\n\n원고:\n${text}` },
  ];
}

export function modelInput(model: string, messages: unknown[], max = 500, temperature = 0.2) {
  if (model === MODEL) return { messages, reasoning: { effort: 'low' }, max_tokens: max, temperature };
  return { messages, chat_template_kwargs: { enable_thinking: false }, temperature, max_completion_tokens: max };
}

/** 모델 답에서 글만 꺼낸다 ({ response } · { choices } · Responses { output } 모두) */
export function readOutput(out: unknown): string {
  if (!out || typeof out !== 'object') return '';
  const o = out as { response?: unknown; output_text?: unknown; choices?: { message?: { content?: unknown } }[]; output?: { type?: string; content?: { type?: string; text?: unknown }[] }[] };
  let raw = '';
  if (typeof o.response === 'string') raw = o.response;
  else if (typeof o.choices?.[0]?.message?.content === 'string') raw = o.choices[0].message.content as string;
  else if (typeof o.output_text === 'string') raw = o.output_text;
  else if (Array.isArray(o.output))
    raw = o.output
      .filter((x) => x?.type === 'message')
      .flatMap((x) => x.content ?? [])
      .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** 요약 글 다듬기: 머리말 · 목록 기호 · 따옴표 덩어리를 걷어 내고 600자로 자른다 */
export function cleanSynopsis(raw: string): string {
  return raw
    .replace(/^\s*(요약|줄거리)\s*[:：]\s*/i, '')
    .split('\n')
    .map((l) => l.replace(/^\s*([-*•·]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^["“](.*)["”]$/s, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 600);
}

// ---- 장 정보 채우기: 줄거리 · 시점 인물 · 장소 · 이야기 속 시간 · 꼬리표를 한 번에 ----
export interface ChapterInfo {
  synopsis: string;
  pov: string;
  place: string;
  time: string;
  tags: string[];
}
export const INFO_MARK = '장 정보를 채우는 편집자';

export function infoMessages(title: string, body: string, people: string[], places: string[]) {
  const { text } = clip(body);
  const names = [people.length ? `세계관의 인물: ${people.slice(0, 80).join(', ')}` : '', places.length ? `세계관의 장소: ${places.slice(0, 80).join(', ')}` : ''].filter(Boolean).join('\n');
  return [
    {
      role: 'system',
      content:
        `너는 소설 원고의 ${INFO_MARK}다. 주어진 원고에 실제로 쓰인 것만 근거로 아래 JSON 하나만 출력한다. 다른 글은 쓰지 않는다.\n` +
        '{"synopsis": "이 장에서 실제로 일어난 사건 2~4문장, 한국어 평서문(-다)", "pov": "이 장을 보고 말하는 시점 인물의 이름 (1인칭 화자면 그 인물 이름, 3인칭 전지적이거나 알 수 없으면 빈 글)", "place": "이 장의 주된 장소 (여러 곳이면 가장 중요한 곳 하나, 없으면 빈 글)", "time": "이야기 속 시간 (원고에 드러난 표현 그대로, 예: 새벽, 사흘 뒤, 겨울 저녁. 없으면 빈 글)", "tags": ["이 장을 나타내는 짧은 낱말 2~5개"]}\n' +
        '원고에 드러나지 않은 것은 추측하지 말고 빈 글로 둔다. 인물 · 장소 이름은 원고에 나온 그대로 쓰고, 세계관 목록에 같은 대상이 있으면 그 이름으로 쓴다. 해석 · 평가 · 앞으로의 전개 추측은 쓰지 않는다.',
    },
    { role: 'user', content: `장 제목: ${title || '(없음)'}\n${names ? `\n${names}\n` : ''}\n원고:\n${text}` },
  ];
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** 모델 답에서 JSON 을 꺼내 장 정보로. 못 읽으면 null */
export function parseInfo(raw: string): ChapterInfo | null {
  const a = raw.indexOf('{');
  const z = raw.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(a, z + 1));
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const tags = Array.isArray(o.tags) ? [...new Set(o.tags.map((t) => s(t, 20).replace(/^#/, '')).filter(Boolean))].slice(0, 5) : [];
  return { synopsis: cleanSynopsis(s(o.synopsis, 800)), pov: s(o.pov, 40), place: s(o.place, 60), time: s(o.time, 60), tags };
}
