// 인물 나이 계산: 인물의 「태어난 해」와 이 장의 연도(장 정보 「이야기 속 시간」 또는 이 장과 이은 연표 사건)로 이 장에서의 나이.
// 연도는 「1998년」 · 「제국력 312년」처럼 숫자 + 년 으로 적은 것만 읽는다. 원고에 「열일곱 살」처럼 쓴 나이와 다르면 알린다.

export function yearIn(text: string | undefined): number | null {
  const m = (text ?? '').match(/(\d{1,5})\s*년/);
  if (m) return Number(m[1]);
  const t = (text ?? '').trim();
  return /^\d{1,5}$/.test(t) ? Number(t) : null;
}

const BIRTH_KEYS = ['태어난 해', '생년', '출생', '출생년도'];
export function birthYear(fields: Record<string, string>): number | null {
  for (const k of BIRTH_KEYS) {
    const y = yearIn(fields[k]);
    if (y != null) return y;
  }
  const age = fields['나이'] ?? '';
  return /년\s*생|년생|년에 태어/.test(age) ? yearIn(age) : null;
}

const TENS: Record<string, number> = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 };
const ONES: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };
const AGE = /(\d{1,3}|(?:열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)?(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?)\s?살/g;

export function koreanNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)?(한|두|세|네|다섯|여섯|일곱|여덟|아홉)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return (m[1] ? TENS[m[1]] : 0) + (m[2] ? ONES[m[2]] : 0);
}

/** 원고에서 이름과 같은 문장에 쓰인 「…살」 */
export function agesSaid(body: string, names: string[]): { age: number; text: string }[] {
  const out: { age: number; text: string }[] = [];
  const ns = names.map((x) => x.trim()).filter(Boolean);
  for (const sentence of body.replace(/%%[\s\S]*?%%/g, '').split(/(?<=[.!?。…])\s+|\n+/)) {
    if (!ns.some((n) => sentence.includes(n))) continue;
    for (const m of sentence.matchAll(AGE)) {
      if (!m[1]) continue;
      const age = koreanNumber(m[1]);
      if (age != null && age > 0 && age < 150) out.push({ age, text: sentence.trim().slice(0, 120) });
    }
  }
  return out;
}

export interface AgeRow {
  name: string;
  born: number;
  /** 만 나이 (생일 전이면 하나 적을 수 있음) */
  age: number;
  /** 원고에 쓴 나이 가운데 만 나이 −1 ~ 세는 나이(만 나이 +1)를 벗어난 것 (생일 전후를 봐준다) */
  mismatch: { age: number; text: string }[];
}
export function agesInChapter(year: number, people: { name: string; aliases: string[]; fields: Record<string, string> }[], body: string): AgeRow[] {
  const out: AgeRow[] = [];
  for (const p of people) {
    const born = birthYear(p.fields);
    if (born == null) continue;
    const age = year - born;
    const said = agesSaid(body, [p.name, ...p.aliases]);
    out.push({ name: p.name, born, age, mismatch: said.filter((s) => s.age < age - 1 || s.age > age + 1) });
  }
  return out;
}
