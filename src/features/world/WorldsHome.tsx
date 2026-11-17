import { api } from '../../lib/api';
import { ago } from '../../lib/text';
import { Empty, Icon, promptBox, Spinner, toast, useAsync } from '../../lib/ui';
import { go } from '../../lib/router';
import type { World } from '../../lib/world';

export function WorldsHome() {
  const { data, loading, error, reload } = useAsync(() => api<{ worlds: World[] }>('worlds'), []);
  const create = async () => {
    const title = await promptBox('새 세계 이름', '');
    if (!title) return;
    try {
      const r = await api('worlds', { body: { title } });
      go(`worlds/${r.world.id}`);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  if (loading && !data) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;
  const worlds = data!.worlds.filter((w) => !w.deleted);
  const trash = data!.worlds.filter((w) => w.deleted);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>세계관</h1>
          <p className="sub">인물 · 장소 · 세력 · 규칙과 그 사이의 관계, 연표를 짓는 곳. 책에 연결하면 원고와 서로 이어져요.</p>
        </div>
        <div className="actions">
          <button className="primary" onClick={create}>
            <Icon name="plus" size={16} />새 세계
          </button>
        </div>
      </div>
      {worlds.length ? (
        <div className="cards">
          {worlds.map((w) => (
            <a key={w.id} className="card" href={`#/worlds/${w.id}`}>
              <span className="spine" style={{ ['--cover' as string]: w.color || 'var(--accent)' }} />
              <span className="inner">
                <span className="title">{w.title}</span>
                {w.summary && <span className="by">{w.summary}</span>}
                <span className="meta">
                  <span>항목 {w.entry_count ?? 0}개</span>
                  <span>{ago(w.updated)} 고침</span>
                </span>
              </span>
            </a>
          ))}
          <button className="card add" onClick={create}>
            <Icon name="plus" />새 세계
          </button>
        </div>
      ) : (
        <Empty title="아직 세계가 없어요" action={<button className="primary" onClick={create}>새 세계 만들기</button>}>
          세계를 만들고 인물부터 하나씩 채워 보세요. 집필실의 「책 설정」에서 책과 연결할 수 있어요.
        </Empty>
      )}
      {!!trash.length && (
        <section className="section" style={{ marginTop: 32 }}>
          <div className="section-head">
            <h2>지운 세계</h2>
          </div>
          <div className="list">
            {trash.map((w) => (
              <div key={w.id} className="list-item">
                <span className="grow">{w.title}</span>
                <button
                  className="small"
                  onClick={async () => {
                    await api(`worlds/${w.id}/restore`, { body: {} });
                    reload();
                  }}
                >
                  되살리기
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
