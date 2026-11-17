// 책 전체 찾아 바꾸기 (src/lib/lib.test.ts 에서 시험)
export function findAll(text: string, find: string, opts: { regex: boolean; ignoreCase: boolean }): { at: number; len: number }[] {
  if (!find) return [];
  const out: { at: number; len: number }[] = [];
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(find, opts.ignoreCase ? 'gi' : 'g');
    } catch {
      return [];
    }
    for (const m of text.matchAll(re)) if (m[0].length) out.push({ at: m.index!, len: m[0].length });
    return out;
  }
  const hay = opts.ignoreCase ? text.toLowerCase() : text;
  const needle = opts.ignoreCase ? find.toLowerCase() : find;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push({ at: i, len: needle.length });
  return out;
}
export function replaceAll(text: string, find: string, to: string, opts: { regex: boolean; ignoreCase: boolean }): string {
  if (!find) return text;
  if (opts.regex) {
    try {
      return text.replace(new RegExp(find, opts.ignoreCase ? 'gi' : 'g'), to);
    } catch {
      return text;
    }
  }
  const hits = findAll(text, find, opts);
  let out = '';
  let last = 0;
  for (const h of hits) {
    out += text.slice(last, h.at) + to;
    last = h.at + h.len;
  }
  return out + text.slice(last);
}

