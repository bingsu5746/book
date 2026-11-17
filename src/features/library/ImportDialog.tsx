// 파일 들이기: 고른 파일을 이 기기에서 읽어 장으로 나누고, 미리 본 뒤 서재에 넣는다.
import { useState } from 'react';
import { ACCEPT, importFile, type ImportedBook } from '../../lib/importers';
import { createBookFrom } from '../../lib/store';
import { charsNoSpace, fmtNum } from '../../lib/text';
import { Icon, Modal, toast } from '../../lib/ui';
import { go } from '../../lib/router';

export function ImportDialog({ onClose, initial, defaultKind = 'read' }: { onClose: () => void; initial?: ImportedBook & { sourceUrl?: string }; defaultKind?: 'read' | 'write' }) {
  const [book, setBook] = useState<(ImportedBook & { sourceUrl?: string }) | null>(initial ?? null);
  const [kind, setKind] = useState<'read' | 'write'>(defaultKind);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy('파일을 읽는 중…');
    try {
      setBook(await importFile(f));
    } catch (e) {
      setErr((e as Error).message || '이 파일을 읽지 못했어요.');
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    if (!book) return;
    setBusy('서재에 넣는 중…');
    try {
      const b = await createBookFrom(
        { title: book.title, author: book.author, kind, nodes: book.nodes, meta: { source: book.source, sourceUrl: book.sourceUrl, importedAt: Date.now() } },
        (d, t) => setBusy(`서재에 넣는 중… ${d}/${t}`),
      );
      toast(`「${b.title}」을(를) 서재에 넣었어요`);
      onClose();
      go(kind === 'read' ? `read/${b.id}` : `write/${b.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy('');
    }
  };
  const total = book ? book.nodes.reduce((s, n) => s + charsNoSpace(n.body), 0) : 0;

  return (
    <Modal
      title="책 들이기"
      onClose={onClose}
      wide={!!book}
      foot={
        book ? (
          <>
            <button onClick={() => setBook(null)} disabled={!!busy}>
              다른 파일
            </button>
            <button className="primary" onClick={save} disabled={!!busy}>
              {busy || '서재에 넣기'}
            </button>
          </>
        ) : undefined
      }
    >
      {!book && (
        <>
          <p className="muted small">EPUB · TXT · Markdown · HTML · Word(.docx) · PDF(글자가 든 것) 파일을 들일 수 있어요. 파일은 이 기기에서 읽고, 글만 내 서재에 저장돼요. 들인 책은 나만 볼 수 있어요.</p>
          <label className="btn primary" style={{ alignSelf: 'flex-start' }}>
            <Icon name="upload" size={16} />
            파일 고르기
            <input type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {busy && <p className="muted">{busy}</p>}
          <p className="muted tiny">글자 파일이 한국어 옛 방식(EUC-KR)이어도 알아서 읽어요. 스캔한 PDF, 암호 걸린(DRM) 전자책은 읽을 수 없어요.</p>
        </>
      )}
      {err && <div className="error-box">{err}</div>}
      {book && (
        <>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">
              제목
              <input className="input" value={book.title} onChange={(e) => setBook({ ...book, title: e.target.value })} />
            </label>
            <label className="field grow">
              지은이
              <input className="input" value={book.author} onChange={(e) => setBook({ ...book, author: e.target.value })} />
            </label>
          </div>
          <div className="row wrap">
            <span className="muted small">어떻게 넣을까요?</span>
            <div className="seg">
              <button className={kind === 'read' ? 'on' : ''} onClick={() => setKind('read')}>
                읽을 책으로
              </button>
              <button className={kind === 'write' ? 'on' : ''} onClick={() => setKind('write')}>
                내 원고로 (고치기)
              </button>
            </div>
          </div>
          {book.notes.map((n) => (
            <p key={n} className="note-box">
              {n}
            </p>
          ))}
          <p className="muted small">
            {book.nodes.filter((n) => n.kind !== 'part').length}장 · {fmtNum(total)}자 (공백 제외). 장 이름은 나중에 집필실에서도 바꿀 수 있어요.
          </p>
          <div className="list" style={{ maxHeight: 320, overflow: 'auto' }}>
            {book.nodes.map((n, i) => (
              <div key={n.tmp} className="list-item" style={{ paddingLeft: n.kind === 'part' ? 14 : n.parent_tmp ? 34 : 14 }}>
                <input
                  className="input"
                  style={{ border: 0, padding: 4, fontWeight: n.kind === 'part' ? 600 : 400 }}
                  value={n.title}
                  onChange={(e) => {
                    const nodes = [...book.nodes];
                    nodes[i] = { ...n, title: e.target.value };
                    setBook({ ...book, nodes });
                  }}
                />
                <span className="faint tiny num" style={{ whiteSpace: 'nowrap' }}>
                  {n.kind === 'part' ? '부' : `${fmtNum(charsNoSpace(n.body))}자`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
