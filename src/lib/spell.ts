// 맞춤법 검사 (기본 규칙): 한국어 글에서 자주 틀리는 표현 · 띄어쓰기 · 문장 부호를 찾는다.
// 표준 맞춤법의 모든 경우를 다루지는 못한다. 확실한 것은 「맞춤법」, 문맥에 따라 다른 것은 「확인」으로 알린다.

export type SpellKind = '맞춤법' | '띄어쓰기' | '문장 부호' | '확인';
export interface SpellIssue {
  from: number;
  to: number;
  text: string;
  fix: string;
  kind: SpellKind;
  why: string;
  rule: string;
}

const hasBatchim = (ch: string, jong?: number) => {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return false;
  const j = c % 28;
  return jong == null ? j !== 0 : j === jong;
};
const RIEUL = 8; // 받침 ㄹ

interface Rule {
  id: string;
  re: RegExp;
  kind: SpellKind;
  why: string;
  /** 바꿀 말. null 이면 이 자리는 넘어간다 */
  fix: (m: RegExpExecArray) => string | null;
}

/** 틀린 낱말 → 바른 낱말 (앞뒤에 다른 한글이 붙어 있어도 틀린 꼴인 것만) */
const WORDS: [string, string, string, SpellKind?][] = [
  ['됬', '됐', '「되었」의 준말은 「됐」이에요.'],
  ['되요', '돼요', '「되어요」의 준말은 「돼요」예요.'],
  ['되서', '돼서', '「되어서」의 준말은 「돼서」예요.'],
  ['되야', '돼야', '「되어야」의 준말은 「돼야」예요.'],
  ['뵈요', '봬요', '「뵈어요」의 준말은 「봬요」예요.'],
  ['몇일', '며칠', '「며칠」로 써요.'],
  ['웬지', '왠지', '「왜인지」의 준말은 「왠지」예요.'],
  ['왠만', '웬만', '「웬만하다」로 써요.'],
  ['왠일', '웬일', '「웬일」로 써요.'],
  ['어떻해', '어떡해', '「어떻게 해」의 준말은 「어떡해」예요.'],
  ['오랫만', '오랜만', '「오래간만」의 준말은 「오랜만」이에요.'],
  ['희안', '희한', '「희한하다」로 써요.'],
  ['설겆이', '설거지', '「설거지」로 써요.'],
  ['일일히', '일일이', '「일일이」로 써요.'],
  ['깨끗히', '깨끗이', '「깨끗이」로 써요.'],
  ['곰곰히', '곰곰이', '「곰곰이」로 써요.'],
  ['틈틈히', '틈틈이', '「틈틈이」로 써요.'],
  ['번번히', '번번이', '「번번이」로 써요.'],
  ['역활', '역할', '「역할」로 써요.'],
  ['어의없', '어이없', '「어이없다」로 써요.'],
  ['내노라', '내로라', '「내로라하다」로 써요.'],
  ['설레임', '설렘', '「설레다」의 명사형은 「설렘」이에요.'],
  ['되뇌이', '되뇌', '「되뇌다」로 써요.'],
  ['애띤', '앳된', '「앳되다」로 써요.'],
  ['닥달', '닦달', '「닦달」로 써요.'],
  ['건들이', '건드리', '「건드리다」로 써요.'],
  ['들어나', '드러나', '「드러나다」로 써요.'],
  ['가르키', '가리키', '방향을 보일 때는 「가리키다」예요.', '확인'],
  ['아니예요', '아니에요', '「아니-」 뒤에는 「-에요」를 써요.'],
  ['거에요', '거예요', '받침 없는 말 뒤 「이에요」의 준말은 「예요」예요.'],
  ['있슴', '있음', '「있음」으로 써요.'],
  ['않돼', '안 돼', '「안(아니) 돼」로 써요. 「않-」은 「아니하-」의 준말이에요.'],
  ['않되', '안 되', '「안(아니) 되-」로 써요.'],
  ['금새', '금세', '「지금 바로」의 뜻이면 「금세」예요. (물건값은 「금새」)', '확인'],
  ['바램', '바람', '「바라다」의 명사형은 「바람」이에요. (빛이 바랜 것이면 그대로)', '확인'],
  ['구지', '굳이', '「굳이」로 써요. (이름이면 그대로)', '확인'],
  ['할려고', '하려고', '「-려고」로 써요.'],
  ['갈려고', '가려고', '「-려고」로 써요.'],
  ['볼려고', '보려고', '「-려고」로 써요.'],
  ['줄려고', '주려고', '「-려고」로 써요.'],
  ['올려고', '오려고', '「오다」+「-려고」는 「오려고」예요. (「올리다」면 그대로)', '확인'],
];

const RULES: Rule[] = [
  ...WORDS.map(([wrong, right, why, kind]): Rule => ({ id: `w:${wrong}`, re: new RegExp(wrong, 'g'), kind: kind ?? '맞춤법', why, fix: () => right })),
  {
    id: 'yeot',
    re: /([가-힣])(이였)/g,
    kind: '맞춤법',
    why: '받침 있는 말 뒤 「이었-」로 써요. (「이였-」은 없는 말이에요)',
    fix: (m) => (hasBatchim(m[1]) ? `${m[1]}이었` : null),
  },
  {
    id: 'kke',
    re: /([가-힣])께(요)?(?=$|[^가-힣])/g,
    kind: '맞춤법',
    why: '약속 · 의지를 나타내는 끝은 「-ㄹ게」예요.',
    fix: (m) => (hasBatchim(m[1], RIEUL) ? `${m[1]}게${m[2] ?? ''}` : null),
  },
  {
    id: 'kkeo',
    re: /([가-힣])꺼(야|예요|에요|지|다|라|면|니|든|란|라고)/g,
    kind: '맞춤법',
    why: '「-ㄹ 것」의 준말은 「-ㄹ 거」예요.',
    fix: (m) => (hasBatchim(m[1], RIEUL) ? `${m[1]} 거${m[2]}` : null),
  },
  {
    id: 'su',
    re: /([가-힣])(\s?)수(\s?)(있|없)/g,
    kind: '띄어쓰기',
    why: '「수」는 앞뒤를 띄어 써요. (할 수 있다)',
    fix: (m) => (hasBatchim(m[1], RIEUL) && !(m[2] && m[3]) ? `${m[1]} 수 ${m[4]}` : null),
  },
  {
    id: 'jul',
    re: /([가-힣])줄(\s?)(알|모르|몰)/g,
    kind: '띄어쓰기',
    why: '「줄」은 앞뒤를 띄어 써요. (할 줄 알다)',
    fix: (m) => (hasBatchim(m[1], RIEUL) ? `${m[1]} 줄 ${m[3]}` : null),
  },
  {
    id: 'geotgat',
    re: /([가-힣]?)(\s?)것(\s?)같/g,
    kind: '띄어쓰기',
    why: '「것」은 앞뒤를 띄어 써요. (그럴 것 같다)',
    fix: (m) => {
      const before = m[1] && hasBatchim(m[1], RIEUL) && !m[2] ? `${m[1]} ` : `${m[1]}${m[2]}`;
      return m[3] && before === `${m[1]}${m[2]}` ? null : `${before}것 같`;
    },
  },
  {
    id: 'anha',
    re: /(^|[^가-힣])안하(?!무인)/g,
    kind: '띄어쓰기',
    why: '부정의 「안」은 띄어 써요. (안 하다)',
    fix: (m) => `${m[1]}안 하`,
  },
  {
    id: 'andwaeyo',
    re: /안\s?되요/g,
    kind: '맞춤법',
    why: '「안 돼요」로 써요.',
    fix: () => '안 돼요',
  },
  {
    id: 'dots',
    re: /(?<!\.)\.{2,6}(?!\.)/g,
    kind: '문장 부호',
    why: '말줄임표는 「…」(또는 「……」)로 써요. 마침표를 여러 개 찍지 않아요.',
    fix: (m) => (m[0].length === 2 ? '…' : m[0].length <= 3 ? '…' : '……'),
  },
  {
    id: 'space-before',
    re: /([가-힣])[ \t]+([.,?!])(?=\s|$|["”’」』)])/g,
    kind: '문장 부호',
    why: '문장 부호 앞에는 띄우지 않아요.',
    fix: (m) => `${m[1]}${m[2]}`,
  },
  {
    id: 'space-after',
    re: /([가-힣][.?!])([가-힣])/g,
    kind: '띄어쓰기',
    why: '문장이 끝나면 띄어 써요.',
    fix: (m) => `${m[1]} ${m[2]}`,
  },
  {
    id: 'double-space',
    re: /([^\s])[ ]{2,}(?=[^\s])/g,
    kind: '띄어쓰기',
    why: '빈칸이 두 번 이상 들어갔어요.',
    fix: (m) => `${m[1]} `,
  },
];

/** 따옴표 짝 (문단마다): 여는 “ 와 닫는 ” 수가 다르거나 " 가 홀수면 알린다 */
function quoteIssues(text: string): SpellIssue[] {
  const out: SpellIssue[] = [];
  let at = 0;
  for (const para of text.split(/\n/)) {
    const open = (para.match(/“/g) ?? []).length;
    const close = (para.match(/”/g) ?? []).length;
    const straight = (para.match(/"/g) ?? []).length;
    if ((open !== close || straight % 2) && para.trim()) {
      const i = para.search(/[“”"]/);
      out.push({ from: at + Math.max(0, i), to: at + Math.max(0, i) + 1, text: para.slice(Math.max(0, i), i + 1), fix: para.slice(Math.max(0, i), i + 1), kind: '확인', why: '이 문단에서 따옴표 짝이 맞지 않아요.', rule: 'quote' });
    }
    at += para.length + 1;
  }
  return out;
}

/** 검사 제외: %%작가 메모%%, [[링크]], 코드 */
function masked(text: string): string {
  return text.replace(/%%[\s\S]*?%%|\[\[[^\]]*\]\]|`[^`]*`/g, (m) => ' '.repeat(m.length));
}

export function checkSpelling(text: string, ignore: Set<string> = new Set()): SpellIssue[] {
  const t = masked(text);
  const out: SpellIssue[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(t))) {
      if (!m[0].length) {
        r.re.lastIndex++;
        continue;
      }
      const fix = r.fix(m);
      if (fix == null || fix === m[0]) continue;
      const wrong = text.slice(m.index, m.index + m[0].length);
      if (ignore.has(`${r.id}|${wrong}`)) continue;
      out.push({ from: m.index, to: m.index + m[0].length, text: wrong, fix, kind: r.kind, why: r.why, rule: r.id });
    }
  }
  for (const q of quoteIssues(t)) if (!ignore.has(`quote|${q.text}|${q.from}`)) out.push(q);
  // 겹치는 것은 앞선 규칙 하나만
  out.sort((a, b) => a.from - b.from || b.to - a.to);
  const res: SpellIssue[] = [];
  for (const i of out) if (!res.length || i.from >= res[res.length - 1].to) res.push(i);
  return res;
}
