// 글자 세기 · 원고지 어림 · 날짜
/** 공백(띄어쓰기 · 줄바꿈)을 뺀 글자 수 */
export const charsNoSpace = (s: string) => s.replace(/\s+/g, '').length;
/** 공백 포함 글자 수 (줄바꿈은 뺀다) */
export const charsWithSpace = (s: string) => s.replace(/\n/g, '').length;
/** 마크다운 기호를 뺀 읽는 글 */
export function plain(md: string): string {
  return md
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/^(\*\s*){3,}$|^(-\s*){3,}$/gm, '')
    .replace(/[*_~`]+/g, '');
}
/** 200자 원고지 매수 어림 (공백 포함 글자 수 ÷ 200, 줄바꿈 칸은 세지 않는 어림값) */
export const manuscriptPages = (s: string) => Math.ceil(charsWithSpace(plain(s)) / 200);
export const fmtNum = (n: number) => n.toLocaleString('ko-KR');
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function fmtDate(t: number | string, withTime = false) {
  const d = new Date(t);
  const s = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  return withTime ? `${s} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s;
}
export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return fmtDate(t);
}
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
