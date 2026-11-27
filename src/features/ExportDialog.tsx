// 내보내기: 책 한 권을 PDF · Word · 전자책 · 글 · 마크다운 · 인쇄용 웹문서로. 원고(쓰는 중)와 다 쓴 책 모두 같은 창을 쓴다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { makeDocx } from '../lib/docx';
import { makeEpubWithCover } from '../lib/epub';
import { api } from '../lib/api';
import { download, toHtml, toMarkdown, toText } from '../lib/exporters';
import { matterNodes, readMatter, tocList } from '../lib/matter';
import { loadFull, toReadNodes, type FullBook } from '../lib/store';
import type { ReadNode } from '../lib/types';
import { Modal, Spinner, toast } from '../lib/ui';
import { DEFAULT_PRINT, FACES, printSettingsOf, type PrintSettings } from '../lib/typeset/settings';
import type { Fonts, PrintReport, Suggestion } from '../lib/typeset';
import { PrintPanel } from './PrintPanel';

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
  const [done, setDone] = useState<{ report: PrintReport; suggestions: Suggestion[]; ps: PrintSettings } | null>(null);
  const fontsRef = useRef<Fonts | null>(null);
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
        // 이 창에서 이어 전자책을 받아도 같은 서식이 되게, 불러 둔 책에도 바로 적어 둔다
        setData((d) => (d ? { ...d, book: { ...d.book, meta: { ...d.book.meta, print: ps } } } : d));
        const mbs = FACES[ps.face].mb + (ps.headFace !== 'same' && ps.headFace !== ps.face ? FACES[ps.headFace].mb : 0);
        setStatus(`인쇄용 글꼴을 받는 중… (처음 한 번 약 ${Math.round(mbs)}MB)`);
        const t = await import('../lib/typeset');
        const { loadImages, imageSrcs } = await import('../lib/typeset/images');
        const fonts = await t.loadPrintFonts(ps.face, ps.headFace);
        fontsRef.current = fonts;
        setStatus('그림을 받는 중…');
        const images = await loadImages(imageSrcs(all.map((n) => n.body)));
        setStatus('조판하는 중…');
        const popts = { ...ps, title: book.title, subtitle: book.subtitle, author: book.author };
        const out = await t.buildPrintPdf(all, popts, fonts, images);
        download(`${name} (인쇄용).pdf`, new Blob([out.bytes as BlobPart], { type: 'application/pdf' }));
        // 점검에 걸린 곳이 있으면 줄 간격 · 자간 · 글자 크기로 풀리는지 알려 준다
        const suggestions = out.issues.length ? t.countPages(all, popts, fonts).suggestions : [];
        setStatus('');
        setDone({ report: out.report, suggestions, ps: { ...ps } });
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
          {fmt === 'pdf' && <PrintPanel ps={ps} setP={setP} />}
          {status && <Spinner label={status} />}
          {done && (
            <div className="ai-card">
              <p className="small" style={{ margin: 0 }}>
                인쇄용 PDF 를 만들었어요 · 모두 {done.report.pages}쪽 · {done.report.trimMm[0]}×{done.report.trimMm[1]}mm{done.report.bleed ? ' (도련 포함 PDF)' : ''}
              </p>
              {!!done.report.missing.length && <p className="small ages-warn" style={{ margin: 0 }}>글꼴에 없는 글자 {done.report.missing.join(' ')} 는 □ 로 나왔어요. 한글로 바꾸거나, 한자는 본명조 · 본고딕을 고르세요.</p>}
              {done.report.images.some((m) => m.dpi < 150) && <p className="small ages-warn" style={{ margin: 0 }}>해상도가 낮은 사진이 있어요(150dpi 아래 {done.report.images.filter((m) => m.dpi < 150).length}장, 가장 낮은 것 {Math.min(...done.report.images.map((m) => m.dpi))}dpi). 더 큰 사진으로 바꾸면 선명하게 찍혀요.</p>}
              {!!done.report.issues.length && (
                <div className="small">
                  <div className="ages-warn">인쇄 전에 볼 곳 {done.report.issues.length}곳</div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {done.report.issues.slice(0, 8).map((m, i) => (
                      <li key={i}>
                        {m.page}쪽 · {m.title} — {m.type === 'short-end' ? `장 마지막 쪽에 ${m.value}줄만 남았어요` : `글이 ${m.value}%만 차 있어요(그림 · 장면 나눔 때문일 수 있어요)`}
                      </li>
                    ))}
                  </ul>
                  {done.suggestions.map((sg) => (
                    <div key={sg.label} className="row wrap" style={{ gap: 8, marginTop: 6 }}>
                      <span>
                        {sg.label} → 점검 {done.report.issues.length}곳 → {sg.issues}곳, 전체 {sg.pages}쪽
                      </span>
                      <button
                        className="small"
                        onClick={() => {
                          setP(sg.patch as Partial<PrintSettings>);
                          setDone(null);
                          toast('적용했어요. 「PDF 만들기」를 다시 눌러 주세요');
                        }}
                      >
                        적용
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="row wrap" style={{ gap: 8 }}>
                <button
                  className="small"
                  onClick={async () => {
                    try {
                      const { makeSpecSheet } = await import('../lib/typeset/spec');
                      if (!fontsRef.current || !data) return;
                      const bytes = await makeSpecSheet({ title: data.book.title, author: data.book.author, date: new Date().toLocaleDateString('sv-SE'), report: done.report, settings: done.ps }, fontsRef.current);
                      download(`${data.book.title || '책'} (인쇄 사양서).pdf`, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
                    } catch (e) {
                      toast((e as Error).message, 'err');
                    }
                  }}
                >
                  인쇄 사양서 받기 (A4 한 장)
                </button>
                <span className="faint tiny">판형 · 여백 · 글꼴 · 사진 해상도를 한 장에 정리해요. PDF 와 함께 인쇄소에 보내세요.</span>
              </div>
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
