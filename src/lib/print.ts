// PDF 만들기: 책을 인쇄용 모양으로 현재 화면 위에 잠깐 깔고 브라우저 인쇄 창을 연다. 대상을 「PDF로 저장」으로 고르면 PDF 파일이 된다.
// (한글 글꼴을 PDF 파일에 직접 넣는 방식은 용량이 너무 커서, 브라우저의 PDF 저장을 쓴다)
export type PageSize = 'A4' | 'A5' | 'sinkook' | 'B6';
export const PAGE_SIZES: { id: PageSize; label: string; css: string; usableMm: number }[] = [
  { id: 'A4', label: 'A4 (210×297mm)', css: 'A4', usableMm: 250 },
  { id: 'A5', label: 'A5 (148×210mm)', css: 'A5', usableMm: 165 },
  { id: 'sinkook', label: '신국판 (152×225mm)', css: '152mm 225mm', usableMm: 180 },
  { id: 'B6', label: 'B6 (128×182mm)', css: '128mm 182mm', usableMm: 138 },
];
export const FONT_SIZES = [
  { id: 'small', label: '작게', pt: 9.5 },
  { id: 'normal', label: '보통', pt: 10.5 },
  { id: 'large', label: '크게', pt: 12 },
] as const;

/** 인쇄용 CSS (모두 #print-root 안에만 적용, 화면에서는 보이지 않는다) */
export function printCss(size: PageSize, pt: number): string {
  const s = PAGE_SIZES.find((x) => x.id === size) ?? PAGE_SIZES[1];
  return `
#print-root{display:none}
@media print{
  html,body{height:auto!important;overflow:visible!important;position:static!important;background:#fff!important}
  body>*:not(#print-root){display:none!important}
  #print-root{display:block;font:${pt}pt/1.85 "Noto Serif KR","Nanum Myeongjo","AppleMyungjo",serif;color:#000;word-break:keep-all}
  @page{size:${s.css};margin:18mm 16mm 20mm;@bottom-center{content:counter(page);font:8.5pt serif;color:#555}}
  #print-root h1,#print-root h2{font-weight:600;line-height:1.4}
  #print-root h1.part{break-before:page;text-align:center;margin:28% 0 0;font-size:1.6em}
  #print-root h2{break-before:page;margin:2.4em 0 1.4em;font-size:1.2em}
  #print-root p{margin:0;text-indent:1em;text-align:justify;orphans:2;widows:2}
  #print-root h2+p,#print-root .scene+p{text-indent:0}
  #print-root .scene{text-align:center;color:#666;margin:1em 0;text-indent:0}
  #print-root blockquote{margin:.6em 0;padding-left:1em;border-left:2px solid #ccc;color:#444}
  #print-root .title{text-align:center;padding-top:34%;break-after:page}
  #print-root .title h1{font-size:2em;margin:0 0 .6em}
  #print-root .title p{text-indent:0;text-align:center}
  #print-root .cover{break-after:page;text-align:center}
  #print-root .cover img{max-width:100%;max-height:${s.usableMm}mm;object-fit:contain}
  #print-root .dedication,#print-root .colophon{break-before:page;text-align:center}
  #print-root .dedication{padding-top:30%;font-style:italic}
  #print-root .colophon{padding-top:55%;font-size:.85em;color:#444}
  #print-root .dedication p,#print-root .colophon p{text-indent:0;text-align:center}
}`;
}

/** 현재 화면 위에 인쇄용 글을 깔고 인쇄 창을 연다. 끝나면(취소 포함) 치운다 */
export async function printPdf(bodyHtml: string, title: string, size: PageSize, pt: number, sampleText: string): Promise<void> {
  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = printCss(size, pt);
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = bodyHtml;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const old = document.title;
  const clean = () => {
    document.title = old;
    style.remove();
    root.remove();
    removeEventListener('afterprint', clean);
  };
  addEventListener('afterprint', clean);
  try {
    // 쓰이는 한글 글꼴 조각이 모두 내려받아진 뒤에 인쇄한다 (안 그러면 일부 글자가 다른 글꼴로 나온다)
    await document.fonts?.load(`400 ${pt}pt "Noto Serif KR"`, sampleText.slice(0, 8000)).catch(() => {});
    await document.fonts?.ready;
    await Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? Promise.resolve() : new Promise((r) => ((i.onload = i.onerror = () => r(null)))))));
  } catch {
    /* 글꼴을 못 기다려도 인쇄는 한다 */
  }
  document.title = title;
  // 화면이 인쇄용으로 바뀔 시간을 한 틱 준다
  await new Promise((r) => setTimeout(r, 150));
  window.print();
  // afterprint 가 오지 않는 브라우저를 위해 오래 뒤에 정리
  setTimeout(clean, 10 * 60_000);
}
