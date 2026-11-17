// 복선 장부: 원고 속 표시 %%복선: 이름%% (깐 곳) · %%회수: 이름%% (거둔 곳) 을 책 전체에서 모은다.
// 「떡밥」 · 「거둠」도 같은 뜻으로 읽는다. 이름 뒤 「 - 메모」는 메모로.

export interface ClueSpot {
  nodeId: string;
  at: number;
  note: string;
}
export interface Clue {
  name: string;
  plants: ClueSpot[];
  payoffs: ClueSpot[];
}

const MARK = /%%\s*(복선|떡밥|회수|거둠)\s*[:：]?\s*([^%\n]+?)\s*%%/g;

export function collectClues(chapters: { id: string; body: string }[]): Clue[] {
  const map = new Map<string, Clue>();
  for (const c of chapters)
    for (const m of c.body.matchAll(MARK)) {
      const [name, ...rest] = m[2].split(/\s+[-–—|]\s+/);
      const key = name.trim();
      if (!key) continue;
      const clue = map.get(key) ?? { name: key, plants: [], payoffs: [] };
      const spot = { nodeId: c.id, at: m.index!, note: rest.join(' - ').trim() };
      (m[1] === '복선' || m[1] === '떡밥' ? clue.plants : clue.payoffs).push(spot);
      map.set(key, clue);
    }
  return [...map.values()];
}

/** 표시를 넣을 자리: 인용이 든 문장의 끝(마침표 뒤) */
export function markerSpot(body: string, quoteAt: number, quoteLen: number): number {
  const from = quoteAt + quoteLen;
  const m = /[.!?。…”"’」』]+/.exec(body.slice(from, from + 200));
  const nl = body.indexOf('\n', from);
  let at = m ? from + m.index + m[0].length : from;
  if (nl >= 0 && nl < at) at = nl;
  return at;
}
export const clueMarker = (kind: 'plant' | 'payoff', name: string) => `%%${kind === 'plant' ? '복선' : '회수'}: ${name}%%`;
