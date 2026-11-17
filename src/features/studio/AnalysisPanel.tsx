// 책 설정의 「분석집」: 만드는 중이면 진행을 보여 주고, 다 되면 해설집으로 가는 길을 준다.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ago } from '../../lib/text';
import type { Book } from '../../lib/types';
import { toast } from '../../lib/ui';

export interface AnalysisStatus {
  job: { id: string; status: 'running' | 'done' | 'error' | 'canceled'; phase: string; step: number; total: number; error: string; updated: number; next_at: number } | null;
  analysisBookId: string | null;
  auto: boolean;
}

export const PHASE_LABEL: Record<string, string> = { chapters: '장을 하나씩 읽는 중', sections: '해설을 쓰는 중', write: '책으로 엮는 중', done: '다 만들었어요' };

export function useAnalysis(bookId: string) {
  const [st, setSt] = useState<AnalysisStatus | null>(null);
  const load = () =>
    api<AnalysisStatus>(`books/${bookId}/analysis`)
      .then(setSt)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (st?.job?.status !== 'running') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [st?.job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    try {
      setSt(await api<AnalysisStatus>(`books/${bookId}/analysis`, { body: { action: 'start' } }));
      toast('분석집을 만들기 시작했어요. 창을 닫아도 서버에서 이어서 만들어요.');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const cancel = async () => setSt(await api<AnalysisStatus>(`books/${bookId}/analysis`, { body: { action: 'cancel' } }));
  return { st, start, cancel, reload: load };
}

export function AnalysisPanel({ book }: { book: Book }) {
  const { st, start, cancel } = useAnalysis(book.id);
  if (book.meta.analysisOf) return null;
  const job = st?.job;
  const running = job?.status === 'running';
  const pct = job ? Math.round((job.step / Math.max(1, job.total)) * 100) : 0;
  return (
    <section className="panel stack">
      <h3 className="serif">분석집</h3>
      <p className="muted small">
        AI 가 원고 전체를 장마다 읽고, 줄거리 · 인물 분석 · 사건의 흐름 · 중요한 물건과 장소 · 주제와 모티프 · 해설을 담은 책 한 권을 만들어요. 「다 썼어요」를 누르거나 판을 찍을 때 저절로 만들고(계정에서 끄기), 여기서 직접 만들 수도 있어요.
      </p>
      {running && job && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row small">
            <span className="grow">
              {PHASE_LABEL[job.phase] ?? '만드는 중'} · {pct}%
            </span>
            <button className="small ghost" onClick={cancel}>
              멈추기
            </button>
          </div>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
          {job.error && <p className="faint tiny">{job.error}</p>}
          <p className="faint tiny">창을 닫아도 서버에서 이어서 만들어요. 책 길이에 따라 몇 분에서 수십 분 걸려요.</p>
        </div>
      )}
      {job?.status === 'error' && <p className="error-box">{job.error || '만들다 멈췄어요.'}</p>}
      {job?.status === 'done' && <p className="faint tiny">{ago(job.updated)} 만들었어요.</p>}
      <div className="row wrap">
        {st?.analysisBookId && (
          <>
            <a className="btn primary" href={`#/read/${st.analysisBookId}`}>
              해설집 읽기
            </a>
            <a className="btn" href={`#/write/${st.analysisBookId}`}>
              해설집 고치기
            </a>
          </>
        )}
        {!running && <button onClick={start}>{st?.analysisBookId ? '다시 만들기 (고친 장만 다시 읽어요)' : '분석집 만들기'}</button>}
      </div>
    </section>
  );
}
