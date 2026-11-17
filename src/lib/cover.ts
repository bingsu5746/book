// 글자 표지: 제목 · 지은이 · 표지 색으로 SVG 표지를 그린다 (서재 · 리더 · EPUB 에 같이 쓴다)
import { coverOf } from './colors';

export type CoverStyle = 'classic' | 'band' | 'minimal';
export const COVER_STYLES: { id: CoverStyle; label: string }[] = [
  { id: 'classic', label: '가운데 제목' },
  { id: 'band', label: '띠 두른' },
  { id: 'minimal', label: '큰 글씨' },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 한 줄에 들어갈 만큼 낱말 단위로 나눈다 (한 낱말이 너무 길면 글자로 자른다) */
export function wrapTitle(title: string, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of title.split(/\s+/).filter(Boolean)) {
    const word = [...w];
    if (word.length > max) {
      if (cur) lines.push(cur), (cur = '');
      for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max).join(''));
      continue;
    }
    if (!cur) cur = w;
    else if ([...cur].length + 1 + word.length <= max) cur += ' ' + w;
    else lines.push(cur), (cur = w);
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}

export function coverSvg(b: { title: string; author: string; color?: string; id: string; style?: CoverStyle }): string {
  const [bg, ink] = coverOf(b.color, b.id);
  const style = b.style ?? 'classic';
  const serif = "'Noto Serif KR','Nanum Myeongjo',serif";
  const sans = "'Pretendard Variable',Pretendard,sans-serif";
  const W = 600;
  const H = 900;
  let body = '';
  if (style === 'classic') {
    const lines = wrapTitle(b.title, 8);
    const size = lines.length > 3 ? 54 : 64;
    const top = H / 2 - ((lines.length - 1) * size * 1.3) / 2;
    body = `<rect x="34" y="34" width="${W - 68}" height="${H - 68}" fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width="2"/>
<rect x="46" y="46" width="${W - 92}" height="${H - 92}" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="1"/>
${lines.map((l, i) => `<text x="${W / 2}" y="${top + i * size * 1.3}" text-anchor="middle" font-family="${serif}" font-weight="600" font-size="${size}" fill="${ink}">${esc(l)}</text>`).join('')}
<line x1="${W / 2 - 40}" x2="${W / 2 + 40}" y1="${top + lines.length * size * 1.3 - 10}" y2="${top + lines.length * size * 1.3 - 10}" stroke="${ink}" stroke-opacity=".5"/>
${b.author ? `<text x="${W / 2}" y="${H - 110}" text-anchor="middle" font-family="${sans}" font-size="28" letter-spacing="4" fill="${ink}" fill-opacity=".85">${esc(b.author)}</text>` : ''}`;
  } else if (style === 'band') {
    const lines = wrapTitle(b.title, 9);
    const size = lines.length > 3 ? 48 : 58;
    body = `<rect x="0" y="${H * 0.56}" width="${W}" height="${H * 0.44}" fill="${ink}" fill-opacity=".92"/>
${lines.map((l, i) => `<text x="56" y="${H * 0.56 + 96 + i * size * 1.3}" font-family="${serif}" font-weight="600" font-size="${size}" fill="${bg}">${esc(l)}</text>`).join('')}
${b.author ? `<text x="56" y="${H - 60}" font-family="${sans}" font-size="26" fill="${bg}" fill-opacity=".8">${esc(b.author)}</text>` : ''}
<circle cx="${W - 120}" cy="200" r="70" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width="2"/>`;
  } else {
    const lines = wrapTitle(b.title, 5);
    const size = lines.length > 3 ? 78 : 96;
    body = `${lines.map((l, i) => `<text x="52" y="${150 + size + i * size * 1.18}" font-family="${serif}" font-weight="600" font-size="${size}" fill="${ink}">${esc(l)}</text>`).join('')}
<line x1="52" x2="140" y1="${H - 150}" y2="${H - 150}" stroke="${ink}" stroke-width="3"/>
${b.author ? `<text x="52" y="${H - 96}" font-family="${sans}" font-size="28" fill="${ink}" fill-opacity=".85">${esc(b.author)}</text>` : ''}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${bg}"/><rect width="18" height="${H}" fill="#000" fill-opacity=".12"/>${body}</svg>`;
}
