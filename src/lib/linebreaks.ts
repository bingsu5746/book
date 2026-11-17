// 줄바꿈 정리: 다른 곳(AI 대화창 등)에서 옮겨 온 글처럼 엔터가 너무 많은 원고를 문단 글로.
// 제목(#) · 인용(>) · 목록 · 장면 나눔(***) · 작가 메모(%% %%) · 쪽 줄거리(%%▸ %%) 줄은 건드리지 않는다.

export type TidyMode = 'blank' | 'join' | 'all';
export const TIDY_MODES: { id: TidyMode; label: string; desc: string }[] = [
  { id: 'blank', label: '빈 줄만 줄이기', desc: '여러 줄 비운 곳을 한 줄로. 문장은 그대로' },
  { id: 'join', label: '한 번 친 엔터 잇기', desc: '빈 줄로 나뉜 문단은 두고, 문단 안에서 줄만 바꾼 곳을 이어 붙여요' },
  { id: 'all', label: '엔터 모두 잇기', desc: '빈 줄까지 없애고 이어 붙여요. 대사는 따로 둘 수 있어요' },
];

const MARK = '\u0000';
const SPECIAL = /^\s*(#{1,6}\s|>|[-+]\s|\d+[.)]\s|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$|\u0000\d+\u0000\s*$)/;
const DIALOGUE = /^\s*[“"「『‘'―—]/;

/** 여러 줄에 걸친 %%메모%% 는 한 덩어리로 묶어 두었다가 되돌린다 */
function protect(text: string): { text: string; back: (s: string) => string } {
  const saved: string[] = [];
  const t = text.replace(/%%[\s\S]*?%%/g, (m) => `${MARK}${saved.push(m) - 1}${MARK}`);
  return { text: t, back: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[Number(i)]) };
}

const glue = (lines: string[]) =>
  lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');

export function tidyBreaks(input: string, mode: TidyMode, opts: { dialogue?: boolean } = {}): string {
  const { text, back } = protect(input.replace(/\r\n?/g, '\n'));
  const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  if (mode === 'blank') return back(lines.join('\n').replace(/\n(\s*\n){2,}/g, '\n\n').replace(/^\n+/, ''));
  const out: string[] = [];
  if (mode === 'join') {
    // 빈 줄로 나뉜 문단마다: 보통 줄은 잇고, 특별한 줄은 제 줄로
    for (const block of lines.join('\n').split(/\n\s*\n/)) {
      const parts: string[] = [];
      let run: string[] = [];
      for (const l of block.split('\n')) {
        if (SPECIAL.test(l)) {
          if (run.length) parts.push(glue(run));
          run = [];
          parts.push(l);
        } else run.push(l);
      }
      if (run.length) parts.push(glue(run));
      const p = parts.filter((x) => x.trim()).join('\n');
      if (p) out.push(p);
    }
    return back(out.join('\n\n'));
  }
  // all: 빈 줄도 무시하고 잇는다. 특별한 줄은 제 문단, 대사를 따로 두면 대사 줄도 제 문단
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(glue(run));
    run = [];
  };
  for (const l of lines) {
    if (!l.trim()) continue;
    if (SPECIAL.test(l)) {
      flush();
      out.push(l);
    } else if (opts.dialogue && DIALOGUE.test(l)) {
      flush();
      out.push(l.trim());
    } else run.push(l);
  }
  flush();
  return back(out.filter((x) => x.trim()).join('\n\n'));
}

export const countBreaks = (s: string) => (s.match(/\n/g) ?? []).length;
