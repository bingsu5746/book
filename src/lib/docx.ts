// Word(.docx) 내보내기: 제목 · 지은이 · 부 · 장 · 본문(문단 들여쓰기) · 장면 나눔만 담은 단순한 문서. 서식(굵게 · 기울임)과 그림은 넣지 않는다.
import { strToU8, zipSync } from 'fflate';
import { plain } from './text';
import type { ReadNode } from './types';

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const para = (text: string, o: { style?: string; center?: boolean; italic?: boolean; small?: boolean; lines?: boolean } = {}) => {
  const lines = o.lines ? text.split('\n') : [text.replace(/\n/g, ' ')];
  const rpr = o.italic || o.small ? `<w:rPr>${o.italic ? '<w:i/>' : ''}${o.small ? '<w:sz w:val="18"/>' : ''}</w:rPr>` : '';
  const runs = lines.map((l) => `<w:r>${rpr}<w:t xml:space="preserve">${esc(l)}</w:t></w:r>`).join('<w:r><w:br/></w:r>');
  const ppr = `${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.center ? '<w:jc w:val="center"/>' : ''}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
};

export function makeDocx(title: string, author: string, nodes: ReadNode[], opts: { breaks?: boolean } = {}): Uint8Array {
  const body: string[] = [para(title, { style: 'Title' })];
  if (author) body.push(para(author, { center: true }));
  body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  for (const n of nodes) {
    const matter = n.id.startsWith('m-');
    if (n.kind === 'part') body.push(para(n.title, { style: 'Heading1' }));
    else if (n.kind === 'chapter') body.push(para(n.title || '제목 없음', { style: 'Heading2' }));
    else if (n.kind === 'scene' && !matter) body.push(para('*  *  *', { center: true }));
    const text = plain(n.body).trim();
    if (!text) continue;
    for (const p of text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
      if (n.id === 'm-dedication') body.push(para(p, { center: true, italic: true, lines: true }));
      else if (n.id === 'm-colophon') body.push(para(p, { center: true, small: true, lines: true }));
      else body.push(para(p, { lines: !!opts.breaks }));
    }
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const font = '<w:rFonts w:ascii="Batang" w:hAnsi="Batang" w:eastAsia="Batang" w:cs="Batang"/>';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="432" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="440"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="4200" w:after="400"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="3000" w:after="600"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="600" w:after="600"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
</w:styles>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipSync({ '[Content_Types].xml': strToU8(ct), '_rels/.rels': strToU8(rels), 'word/document.xml': strToU8(document), 'word/styles.xml': strToU8(styles), 'word/_rels/document.xml.rels': strToU8(docRels) });
}
