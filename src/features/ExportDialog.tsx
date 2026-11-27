// 내보내기: 책 한 권을 PDF · Word · 전자책 · 글 · 마크다운 · 인쇄용 웹문서로. 원고(쓰는 중)와 다 쓴 책 모두 같은 창을 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { makeDocx } from '../lib/docx';
import { makeEpubWithCover } from '../lib/epub';
import { api } from '../lib/api';
import { download, toHtml, toMarkdown, toText } from '../lib/exporters';
import { matterNodes, readMatter, tocList } from '../lib/matter';
import { loadFull, toReadNodes, type FullBook } from '../lib/store';
import type { ReadNode } from '../lib/types';
import { Modal, Spinner, toast } from '../lib/ui';
import { DEFAULT_PRINT, printSettingsOf, type PrintSettings } from '../lib/typeset/settings';
import { SIZES } from '../lib/typeset/layout';

type Fmt = 'pdf' | 'docx' | 'epub' | 'txt' | 'md' | 'html';
const FORMATS: { id: Fmt; label: string; desc: string }[] = [
  { id: 'pdf', label: '인쇄용 PDF', desc: '인쇄소에 바로 보낼 수 있는 책 꼴 PDF 를 바로 받아요. 판형 · 여백 · 목차 쪽수 · 주석 · 판권면까지 짜 넣어요.' },
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
  const [ps, setPs] = useState<PrintSettings>(DEFAULT_PRINT);
  const [withMatter, setWithMatter] = useState(true);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState<{ pages: number; missing: string[] } | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadFull(bookId)
      .then((r) => {
        setData(r.data);
        setPs(printSettingsOf(r.data.book.meta));
      })
      .catch((e) => setErr((e as Error).message));
  }, [bookId]);

  const nodes = useMemo(() => (data ? toReadNodes(data.nodes) : []), [data]);
  const matter = data ? readMatter(data.book.meta) : {};
  const hasMatter = !!(matter.dedication?.trim() || matter.afterword?.trim() || matter.colophon || matter.toc);
  const setP = (p: Partial<PrintSettings>) => setPs((o) => ({ ...o, ...p }));
  const picked = nodes.filter((n) => !off.has(n.id) && (n.body.trim() || n.kind === 'part' || n.kind === 'chapter'));

  const run = async () => {
    if (!data) return;
    const book = data.book;
    if (!picked.some((n) => n.body.trim())) return toast('내보낼 글이 없어요. 고른 장을 확인해 주세요.', 'err');
    setBusy(true);
    try {
      const asText = fmt === 'txt' || fmt === 'md' || fmt === 'docx' || fmt === 'pdf';
      const m = withMatter ? matterNodes(book, { number: book.last_edition ?? undefined, date: new Date().toLocaleDateString('sv-SE') }, { plain: asText, toc: tocList(picked) }) : { front: [], back: [] };
      const all: ReadNode[] = [...m.front, ...picked, ...m.back];
      const breaks = book.kind === 'write';
      const name = book.title || '책';
      if (fmt === 'txt') download(`${name}.txt`, toText(book.title, book.author, all));
      else if (fmt === 'md') download(`${name}.md`, toMarkdown(book.title, book.author, all), 'text/markdown;charset=utf-8');
      else if (fmt === 'html') download(`${name}.html`, toHtml(book.title, book.author, all, { breaks }), 'text/html;charset=utf-8');
      else if (fmt === 'docx') download(`${name}.docx`, new Blob([makeDocx(book.title, book.author, all, { breaks }) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      else if (fmt === 'epub') download(`${name}.epub`, new Blob([(await makeEpubWithCover(book, all, { breaks })) as BlobPart], { type: 'application/epub+zip' }));
      else {
        // 인쇄용 PDF: 글꼴 · 그림을 받아 조판한다 (설정은 책에 남겨 집필실 목차 쪽수와 맞춘다)
        if (book.owner) void api(`books/${book.id}`, { method: 'PATCH', body: { meta: { ...book.meta, print: ps } } }).catch(() => {});
        setStatus('인쇄용 글꼴을 받는 중… (처음 한 번 약 17MB)');
        const t = await import('../lib/typeset');
        const { loadImages, imageSrcs } = await import('../lib/typeset/images');
        const fonts = await t.loadPrintFonts();
        setStatus('그림을 받는 중…');
        const images = await loadImages(imageSrcs(all.map((n) => n.body)));
        setStatus('조판하는 중…');
        const out = await t.buildPrintPdf(all, { ...ps, title: book.title, subtitle: book.subtitle, author: book.author }, fonts, images);
        download(`${name} (인쇄용).pdf`, new Blob([out.bytes as BlobPart], { type: 'application/pdf' }));
        setStatus('');
        setDone({ pages: out.pages, missing: out.missing });
        return;
      }
      toast(`${FORMATS.find((f) => f.id === fmt)!.label} 파일을 만들었어요`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
      setStatus('');
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
                  <select className="input" value={ps.size} onChange={(e) => setP({ size: e.target.value as PrintSettings['size'] })}>
                    {Object.entries(SIZES).map(([id, s]) => (
                      <option key={id} value={id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  글자 크기
                  <div className="seg">
                    {(
                      [
                        ['small', '작게'],
                        ['normal', '보통'],
                        ['large', '크게'],
                      ] as const
                    ).map(([id, l]) => (
                      <button key={id} className={ps.font === id ? 'on' : ''} onClick={() => setP({ font: id })}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  주석 표시
                  <div className="seg">
                    <button className={ps.noteStyle === 'star' ? 'on' : ''} onClick={() => setP({ noteStyle: 'star' })}>
                      * 별표
                    </button>
                    <button className={ps.noteStyle === 'number' ? 'on' : ''} onClick={() => setP({ noteStyle: 'number' })}>
                      1 숫자
                    </button>
                  </div>
                </div>
              </div>
              <label className="check">
                <input type="checkbox" checked={ps.rightStart} onChange={(e) => setP({ rightStart: e.target.checked })} />장 · 부를 오른쪽(홀수) 쪽에서 시작 (책에서 흔한 방식, 필요하면 빈 쪽을 넣어요)
              </label>
              <label className="check">
                <input type="checkbox" checked={ps.heads} onChange={(e) => setP({ heads: e.target.checked })} />
                머리글 (왼쪽 쪽에 책 제목, 오른쪽 쪽에 장 제목)
              </label>
              <label className="check">
                <input type="checkbox" checked={ps.multipleOf4} onChange={(e) => setP({ multipleOf4: e.target.checked })} />
                전체 쪽수를 4의 배수로 (제본용, 판권면 앞에 빈 쪽)
              </label>
              <label className="check">
                <input type="checkbox" checked={ps.bleed} onChange={(e) => setP({ bleed: e.target.checked })} />
                도련(재단 여백) 사방 3mm 넣기 — 인쇄소가 요구할 때만
              </label>
              <p className="faint tiny" style={{ margin: 0 }}>
                본문은 고운바탕 글꼴(OFL)을 PDF 안에 넣어 어느 인쇄소에서 열어도 같게 나와요. 표지는 책등 두께가 쪽수 · 종이에 따라 달라 따로 만들어야 해요. 인쇄소마다 요구(도련 · 판형 · 색 방식)가 다르니 보내기 전에 그곳 안내를 한 번 확인해 주세요.
              </p>
            </div>
          )}
          {status && <Spinner label={status} />}
          {done && (
            <div className="ai-card">
              <p className="small" style={{ margin: 0 }}>
                인쇄용 PDF 를 만들었어요 · 모두 {done.pages}쪽
              </p>
              {!!done.missing.length && <p className="small ages-warn" style={{ margin: 0 }}>글꼴에 없는 글자 {done.missing.join(' ')} 는 □ 로 나왔어요(고운바탕에는 한자가 없어요). 한글로 바꾸거나 괄호에 한글을 함께 적어 주세요.</p>}
            </div>
          )}
          {hasMatter && (
            <label className="check">
              <input type="checkbox" checked={withMatter} onChange={(e) => setWithMatter(e.target.checked)} />
              목차 · 헌사 · 작가의 말 · 판권면 넣기 (책 설정 「앞붙이 · 뒷붙이」에서 정해요)
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
