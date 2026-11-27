// 내보내기: 책 한 권을 PDF · Word · 전자책 · 글 · 마크다운 · 인쇄용 웹문서로. 원고(쓰는 중)와 다 쓴 책 모두 같은 창을 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { coverUrl } from '../lib/BookCard';
import { makeDocx } from '../lib/docx';
import { makeEpubWithCover } from '../lib/epub';
import { bookBodyHtml, download, toHtml, toMarkdown, toText } from '../lib/exporters';
import { matterNodes, readMatter } from '../lib/matter';
import { FONT_SIZES, PAGE_SIZES, printPdf, type PageSize } from '../lib/print';
import { loadFull, toReadNodes, type FullBook } from '../lib/store';
import { plain } from '../lib/text';
import type { ReadNode } from '../lib/types';
import { Modal, Spinner, toast } from '../lib/ui';

type Fmt = 'pdf' | 'docx' | 'epub' | 'txt' | 'md' | 'html';
const FORMATS: { id: Fmt; label: string; desc: string }[] = [
  { id: 'pdf', label: 'PDF', desc: '인쇄 창에서 「PDF로 저장」을 골라 파일로 받아요. 판형 · 글자 크기를 정할 수 있어요.' },
  { id: 'docx', label: 'Word (.docx)', desc: '워드 · 한글 · 구글 문서에서 열어 고칠 수 있어요. 굵게 · 기울임 같은 꾸밈은 빠져요.' },
  { id: 'epub', label: '전자책 (.epub)', desc: '전자책 앱에서 읽어요. 그림 표지가 있으면 들어가요.' },
  { id: 'txt', label: '글 (.txt)', desc: '꾸밈 없는 글 파일이에요.' },
  { id: 'md', label: '마크다운 (.md)', desc: '제목 · 굵게 · 인용 표시를 남긴 글 파일이에요.' },
  { id: 'html', label: '인쇄용 웹문서 (.html)', desc: '브라우저로 열어 그대로 인쇄할 수 있어요.' },
];

export function ExportDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [data, setData] = useState<FullBook | null>(null);
  const [err, setErr] = useState('');
  const [fmt, setFmt] = useState<Fmt>('pdf');
  const [size, setSize] = useState<PageSize>('A5');
  const [font, setFont] = useState<(typeof FONT_SIZES)[number]['id']>('normal');
  const [withMatter, setWithMatter] = useState(true);
  const [withCover, setWithCover] = useState(true);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadFull(bookId)
      .then((r) => setData(r.data))
      .catch((e) => setErr((e as Error).message));
  }, [bookId]);

  const nodes = useMemo(() => (data ? toReadNodes(data.nodes) : []), [data]);
  const matter = data ? readMatter(data.book.meta) : {};
  const hasMatter = !!(matter.dedication?.trim() || matter.afterword?.trim() || matter.colophon);
  const hasCover = !!data && !!coverUrl(data.book.id, data.book.meta);
  const picked = nodes.filter((n) => !off.has(n.id) && (n.body.trim() || n.kind === 'part' || n.kind === 'chapter'));

  const run = async () => {
    if (!data) return;
    const book = data.book;
    if (!picked.some((n) => n.body.trim())) return toast('내보낼 글이 없어요. 고른 장을 확인해 주세요.', 'err');
    setBusy(true);
    try {
      const asText = fmt === 'txt' || fmt === 'md' || fmt === 'docx';
      const m = withMatter ? matterNodes(book, { number: book.last_edition ?? undefined, date: new Date().toLocaleDateString('sv-SE') }, { plain: asText }) : { front: [], back: [] };
      const all: ReadNode[] = [...m.front, ...picked, ...m.back];
      const breaks = book.kind === 'write';
      const name = book.title || '책';
      if (fmt === 'txt') download(`${name}.txt`, toText(book.title, book.author, all));
      else if (fmt === 'md') download(`${name}.md`, toMarkdown(book.title, book.author, all), 'text/markdown;charset=utf-8');
      else if (fmt === 'html') download(`${name}.html`, toHtml(book.title, book.author, all, { breaks }), 'text/html;charset=utf-8');
      else if (fmt === 'docx') download(`${name}.docx`, new Blob([makeDocx(book.title, book.author, all, { breaks }) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      else if (fmt === 'epub') download(`${name}.epub`, new Blob([(await makeEpubWithCover(book, all, { breaks })) as BlobPart], { type: 'application/epub+zip' }));
      else {
        let cover: string | undefined;
        const url = coverUrl(book.id, book.meta);
        if (withCover && url) {
          try {
            const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
            cover = await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(String(r.result));
              r.onerror = () => rej(r.error);
              r.readAsDataURL(blob);
            });
          } catch {
            /* 표지 그림 없이 */
          }
        }
        const pt = FONT_SIZES.find((f) => f.id === font)!.pt;
        const sample = all.map((n) => `${n.title}${plain(n.body)}`).join('') + book.title + book.author;
        toast('인쇄 창에서 「PDF로 저장」을 골라 주세요.');
        onClose();
        await printPdf(bookBodyHtml(book.title, book.author, all, { breaks, cover }), name, size, pt, sample);
        return;
      }
      toast(`${FORMATS.find((f) => f.id === fmt)!.label} 파일을 만들었어요`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const chapters = nodes.filter((n) => n.kind === 'part' || n.kind === 'chapter' || n.kind === 'scene');
  return (
    <Modal
      wide
      title={`내보내기${data ? ` · ${data.book.title}` : ''}`}
      onClose={onClose}
      foot={
        <>
          <button onClick={onClose}>닫기</button>
          <button className="primary" disabled={!data || busy} onClick={run}>
            {busy ? '만드는 중…' : fmt === 'pdf' ? 'PDF 만들기' : '내보내기'}
          </button>
        </>
      }
    >
      {err && <p className="error-box">{err}</p>}
      {!data && !err && <Spinner />}
      {data && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            {FORMATS.map((f) => (
              <label key={f.id} className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="radio" name="export-fmt" checked={fmt === f.id} onChange={() => setFmt(f.id)} style={{ marginTop: 5 }} />
                <span>
                  <b>{f.label}</b>
                  <span className="faint tiny" style={{ display: 'block' }}>
                    {f.desc}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {fmt === 'pdf' && (
            <div className="ai-card">
              <div className="row wrap" style={{ gap: 12 }}>
                <label className="field">
                  판형
                  <select className="input" value={size} onChange={(e) => setSize(e.target.value as PageSize)}>
                    {PAGE_SIZES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  글자 크기
                  <div className="seg">
                    {FONT_SIZES.map((f) => (
                      <button key={f.id} className={font === f.id ? 'on' : ''} onClick={() => setFont(f.id)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {hasCover && (
                <label className="check">
                  <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} />첫 쪽에 그림 표지 넣기
                </label>
              )}
              <p className="faint tiny" style={{ margin: 0 }}>
                인쇄 창이 열리면 「대상(프린터)」을 <b>PDF로 저장</b>으로 고르세요. 「머리글 및 바닥글」은 끄고, 여백은 「기본」으로 두면 판형대로 나와요. 쪽 번호는 크롬 · 엣지에서 아래에 들어가요. 폰에서는 인쇄 창의 공유 · 저장 메뉴에서 PDF 로 저장하세요.
              </p>
            </div>
          )}
          {hasMatter && (
            <label className="check">
              <input type="checkbox" checked={withMatter} onChange={(e) => setWithMatter(e.target.checked)} />
              헌사 · 작가의 말 · 판권면 넣기
            </label>
          )}
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>
              내보낼 장 고르기 <span className="faint tiny">· 지금 {picked.filter((n) => n.kind !== 'scene' || n.body.trim()).length}칸 · 기본은 전부</span>
            </summary>
            <div className="row wrap" style={{ gap: 6, margin: '8px 0' }}>
              <button className="small" onClick={() => setOff(new Set())}>
                모두 고르기
              </button>
              <button className="small" onClick={() => setOff(new Set(chapters.map((n) => n.id)))}>
                모두 빼기
              </button>
            </div>
            <div className="stack" style={{ gap: 2, maxHeight: 220, overflow: 'auto' }}>
              {chapters.map((n) => (
                <label key={n.id} className="check" style={{ paddingLeft: n.depth * 16 }}>
                  <input
                    type="checkbox"
                    checked={!off.has(n.id)}
                    onChange={(e) =>
                      setOff((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.delete(n.id);
                        else next.add(n.id);
                        return next;
                      })
                    }
                  />
                  <span className="small">{n.title || (n.kind === 'scene' ? '장면' : '제목 없음')}</span>
                </label>
              ))}
            </div>
          </details>
        </>
      )}
    </Modal>
  );
}
