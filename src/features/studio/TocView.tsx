// 목차: 부 · 장 제목과 인쇄했을 때의 쪽수. 인쇄용 PDF 와 같은 조판으로 세어서, 글을 고치면 잠시 뒤 쪽수가 저절로 바뀐다.
import { useEffect, useMemo, useState } from 'react';
import { matterNodes, readMatter, tocList } from '../../lib/matter';
import { toReadNodes } from '../../lib/store';
import type { Book, BookNode } from '../../lib/types';
import { Spinner } from '../../lib/ui';
import { FACES, printSettingsOf, type FaceId, type PrintSettings } from '../../lib/typeset/settings';
import { SIZES } from '../../lib/typeset/layout';

interface Entry {
  id: string;
  title: string;
  level: number;
  page: number;
}

export function TocView({ book, nodes, onOpen, onPatchBook }: { book: Book; nodes: BookNode[]; onOpen: (id: string) => void; onPatchBook: (p: Record<string, unknown>) => void }) {
  const ps = printSettingsOf(book.meta);
  const matter = readMatter(book.meta);
  const [res, setRes] = useState<{ toc: Entry[]; pages: number } | null>(null);
  const [status, setStatus] = useState(`인쇄용 글꼴(${FACES[ps.face].name})을 받는 중… (처음 한 번 약 ${FACES[ps.face].mb}MB)`);
  const [err, setErr] = useState('');
  // 글 · 제목 · 설정이 바뀔 때만 다시 센다
  const sig = useMemo(() => nodes.map((n) => `${n.id}:${n.title}:${n.kind}:${n.deleted ? 1 : 0}:${(n.body ?? '').length}`).join('|') + JSON.stringify(ps) + JSON.stringify(matter) + book.title, [nodes, ps, matter, book.title]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const ts = await import('../../lib/typeset');
        setStatus(`인쇄용 글꼴(${FACES[ps.face].name})을 받는 중… (처음 한 번 약 ${FACES[ps.face].mb}MB)`);
        const fonts = await ts.loadPrintFonts(ps.face);
        if (!live) return;
        setStatus('');
        const body = toReadNodes(nodes);
        const m = matterNodes(book, { number: book.last_edition ?? undefined, date: new Date().toLocaleDateString('sv-SE') }, { plain: true, toc: tocList(body) });
        const r = ts.countPages([...m.front, ...body, ...m.back], { ...ps, title: book.title, subtitle: book.subtitle, author: book.author }, fonts);
        if (live) setRes({ toc: r.toc, pages: r.pages });
      } catch (e) {
        if (live) setErr((e as Error).message);
      }
    }, res ? 1500 : 50);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPrint = (p: Partial<PrintSettings>) => onPatchBook({ meta: { ...book.meta, print: { ...ps, ...p } } });
  return (
    <div className="view-pad stack" style={{ gap: 18, maxWidth: 720 }}>
      <section className="panel stack">
        <div className="row wrap" style={{ gap: 12 }}>
          <h3 className="serif grow" style={{ margin: 0 }}>
            목차
          </h3>
          <label className="check small">
            <input type="checkbox" checked={matter.toc !== false} onChange={(e) => onPatchBook({ meta: { ...book.meta, matter: { ...matter, toc: e.target.checked } } })} />책에 목차 쪽 넣기
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          쪽수는 인쇄용 PDF 와 같은 조판으로 세어요. 글을 쓰거나 장을 옮기면 잠시 뒤 저절로 바뀌어요. 리더 · 전자책에서는 목차에 쪽수 없이 제목만 나와요.
        </p>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field">
            판형
            <select className="input" value={ps.size} onChange={(e) => setPrint({ size: e.target.value as PrintSettings['size'] })}>
              {Object.entries(SIZES).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            글꼴
            <select className="input" value={ps.face} onChange={(e) => setPrint({ face: e.target.value as FaceId })}>
              {(Object.entries(FACES) as [FaceId, (typeof FACES)[FaceId]][]).map(([id, f]) => (
                <option key={id} value={id}>
                  {f.name} ({f.kind})
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
                <button key={id} className={ps.font === id ? 'on' : ''} onClick={() => setPrint({ font: id })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="panel stack toc-page">
        {err && <p className="error-box">{err}</p>}
        {!res && !err && <Spinner label={status || '쪽수를 세는 중…'} />}
        {res && (
          <>
            {!res.toc.length && <p className="faint small">장이 없어요. 원고에 장을 만들면 여기에 나와요.</p>}
            {res.toc.map((e) => (
              <button key={e.id} className="toc-row" style={{ paddingLeft: e.level ? 28 : 0, fontWeight: e.level === 0 && res.toc.some((x) => x.level === 1) ? 600 : 400 }} onClick={() => !e.id.startsWith('m-') && onOpen(e.id)} disabled={e.id.startsWith('m-')}>
                <span className="serif">{e.title}</span>
                <span className="toc-dots" aria-hidden="true" />
                <span className="num">{e.page}</span>
              </button>
            ))}
            <p className="faint tiny" style={{ marginTop: 8 }}>
              인쇄하면 모두 {res.pages}쪽 · {SIZES[ps.size].label.split(' (')[0]} · {ps.rightStart ? '장은 오른쪽 쪽에서 시작' : '장은 바로 다음 쪽에서 시작'} · 자세한 설정은 ⋯ 메뉴 「내보내기 → 인쇄용 PDF」
            </p>
          </>
        )}
      </section>
    </div>
  );
}
