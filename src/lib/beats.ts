// 쪽 줄거리(구상): 원고 안에 한 줄로 들어가는 표시 「%%▸ 이 쪽에서 쓸 내용%%」.
// 다음 표시가 나올 때까지의 글이 그 쪽 줄거리에 딸린 본문이다 (길이 제한 없음 — 한 쪽 이상도 된다).
// %%…%% 는 작가 메모라서 리더 · 공유본 · 내보내기 · 맞춤법 · AI 요약에는 보이지 않는다.

export const BEAT_LINE = /^%%▸[ \t]?(.*?)%%[ \t]*$/;
export const beatLine = (text: string) => `%%▸ ${text.replace(/%%/g, '%').replace(/\n/g, ' ').trim()}%%`;

export interface Beat {
  /** 이 쪽 줄거리 표시 줄이 시작하는 글자 위치 */
  at: number;
  /** 표시 줄 끝(줄바꿈 앞) */
  lineEnd: number;
  /** 딸린 본문이 끝나는 위치 (다음 표시 직전 또는 글 끝) */
  end: number;
  text: string;
  /** 딸린 본문 (표시 줄 다음부터) */
  body: string;
}

export function parseBeats(doc: string): { pre: string; beats: Beat[] } {
  const beats: Beat[] = [];
  let pos = 0;
  const lines = doc.split('\n');
  const starts: { at: number; lineEnd: number; text: string }[] = [];
  for (const l of lines) {
    const m = l.match(BEAT_LINE);
    if (m) starts.push({ at: pos, lineEnd: pos + l.length, text: m[1].trim() });
    pos += l.length + 1;
  }
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : doc.length;
    beats.push({ ...s, end, body: doc.slice(Math.min(doc.length, s.lineEnd + 1), end) });
  });
  return { pre: doc.slice(0, starts[0]?.at ?? doc.length), beats };
}

/** 본문을 이만큼 썼으면 「썼음」 */
export const beatWritten = (b: Beat) => b.body.replace(/%%[\s\S]*?%%/g, '').replace(/\s/g, '').length >= 30;

/** 커서가 들어 있는 쪽 줄거리 */
export function beatAt(doc: string, pos: number): { beat: Beat; index: number; total: number } | null {
  const { beats } = parseBeats(doc);
  for (let i = beats.length - 1; i >= 0; i--) if (beats[i].at <= pos) return { beat: beats[i], index: i, total: beats.length };
  return null;
}

/** 끝에 쪽 줄거리 더하기 */
export function addBeat(doc: string, text: string): string {
  const base = doc.replace(/\s+$/, '');
  return `${base}${base ? '\n\n' : ''}${beatLine(text)}\n`;
}

/** i 번째 쪽 줄거리의 글 바꾸기 (본문은 그대로) */
export function renameBeat(doc: string, i: number, text: string): string {
  const b = parseBeats(doc).beats[i];
  if (!b) return doc;
  return doc.slice(0, b.at) + beatLine(text) + doc.slice(b.lineEnd);
}

/** i 번째 쪽 줄거리 표시만 빼기 (쓴 본문은 앞 쪽에 이어 남는다) */
export function removeBeat(doc: string, i: number): string {
  const b = parseBeats(doc).beats[i];
  if (!b) return doc;
  const after = doc.slice(b.lineEnd + 1);
  return (doc.slice(0, b.at) + after).replace(/\n{3,}/g, '\n\n');
}

/** i 번째 쪽 줄거리를 딸린 본문과 함께 앞(-1) · 뒤(+1)로 */
export function moveBeat(doc: string, i: number, d: -1 | 1): string {
  const { pre, beats } = parseBeats(doc);
  const j = i + d;
  if (!beats[i] || !beats[j]) return doc;
  const seg = beats.map((b) => {
    const s = doc.slice(b.at, b.end);
    return s.endsWith('\n') ? s : s + '\n';
  });
  [seg[i], seg[j]] = [seg[j], seg[i]];
  return (pre + seg.join('')).replace(/\n+$/, '\n');
}
