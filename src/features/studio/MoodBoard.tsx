// 무드보드: 이 책의 분위기에 맞는 사진 · 그림을 모아 두는 판. 나만 보이고 공유본 · 링크에는 나가지 않는다.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { shrinkImage } from '../../lib/image';
import { confirmBox, Empty, Icon, Modal, promptBox, Spinner, toast } from '../../lib/ui';

interface Mood {
  id: string;
  caption: string;
  sort: number;
  created: number;
}

export function MoodBoard({ bookId }: { bookId: string }) {
  const [list, setList] = useState<Mood[] | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [view, setView] = useState<Mood | null>(null);
  const load = () =>
    api<{ moods: Mood[] }>(`books/${bookId}/moods`)
      .then((r) => setList(r.moods))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: FileList | null) => {
    const fs = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!fs.length) return;
    setBusy({ done: 0, total: fs.length });
    let ok = 0;
    for (const f of fs) {
      try {
        const img = await shrinkImage(f, 1100, 0.8);
        await api(`books/${bookId}/moods`, { body: { mime: img.mime, data: img.data, caption: '' } });
        ok++;
      } catch (e) {
        toast((e as Error).message, 'err');
        break;
      }
      setBusy({ done: ok, total: fs.length });
    }
    setBusy(null);
    if (ok) toast(`${ok}장을 올렸어요`);
    void load();
  };
  const caption = async (m: Mood) => {
    const c = await promptBox('그림 설명 (선택)', m.caption, { placeholder: '예: 1부 끝, 비 오는 항구' });
    if (c == null) return;
    await api(`moods/${m.id}`, { method: 'PATCH', body: { caption: c } }).catch((e) => toast((e as Error).message, 'err'));
    void load();
  };
  const del = async (m: Mood) => {
    if (!(await confirmBox('이 그림을 무드보드에서 뺄까요?', { ok: '빼기', danger: true }))) return;
    await api(`moods/${m.id}`, { method: 'DELETE' }).catch((e) => toast((e as Error).message, 'err'));
    setView(null);
    void load();
  };

  return (
    <div className="view-pad stack" style={{ gap: 16, maxWidth: 1100 }}>
      <div className="row wrap">
        <div className="grow">
          <h3 className="serif" style={{ margin: 0 }}>
            무드보드
          </h3>
          <p className="muted small" style={{ margin: 0 }}>
            이 책의 분위기에 맞는 사진 · 그림을 모아 두세요. 나만 보이고, 공유본 · 링크에는 나가지 않아요. 한 책에 40장까지예요.
          </p>
        </div>
        <label className="btn primary small">
          <Icon name="upload" size={14} />
          {busy ? `올리는 중 ${busy.done}/${busy.total}` : '그림 올리기'}
          <input type="file" accept="image/*" multiple hidden disabled={!!busy} onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
        </label>
      </div>
      {!list ? (
        <Spinner />
      ) : !list.length ? (
        <Empty title="아직 그림이 없어요">분위기가 닮은 사진 · 그림을 올려 보세요. 여러 장을 한꺼번에 올릴 수 있어요.</Empty>
      ) : (
        <div className="mood-grid">
          {list.map((m) => (
            <figure key={m.id} className="mood-tile">
              <button className="mood-img" onClick={() => setView(m)} aria-label={m.caption || '그림 크게 보기'}>
                <img src={`/api/moods/${m.id}`} alt={m.caption} loading="lazy" />
              </button>
              <figcaption>
                <span className="grow small">{m.caption || <span className="faint">설명 없음</span>}</span>
                <button className="ghost small" onClick={() => caption(m)}>
                  설명
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {view && (
        <Modal
          wide
          title={view.caption || '무드보드'}
          onClose={() => setView(null)}
          foot={
            <>
              <button className="danger" onClick={() => del(view)}>
                빼기
              </button>
              <span className="grow" />
              <button onClick={() => setView(null)}>닫기</button>
            </>
          }
        >
          <img src={`/api/moods/${view.id}`} alt={view.caption} style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 6 }} />
        </Modal>
      )}
    </div>
  );
}
