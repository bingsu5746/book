import { coverOf } from './colors';
import { fmtNum } from './text';

export function BookCard({ title, by, color, seed, meta, progress, href, onClick }: { title: string; by?: string; color?: string; seed: string; meta?: React.ReactNode[]; progress?: number | null; href?: string; onClick?: () => void }) {
  const [bg] = coverOf(color, seed);
  const inner = (
    <>
      <span className="spine" style={{ ['--cover' as string]: bg }} />
      <span className="inner">
        <span className="title">{title}</span>
        {by && <span className="by">{by}</span>}
        {progress != null && (
          <span className="meter" aria-label={`${Math.round(progress * 100)}% 읽음`}>
            <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}
        {!!meta?.filter(Boolean).length && (
          <span className="meta">
            {meta.filter(Boolean).map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </span>
        )}
      </span>
    </>
  );
  return href ? (
    <a className="card" href={href}>
      {inner}
    </a>
  ) : (
    <button className="card" onClick={onClick}>
      {inner}
    </button>
  );
}

export function Cover({ title, color, seed, small }: { title: string; color?: string; seed: string; small?: boolean }) {
  const [bg, ink] = coverOf(color, seed);
  return (
    <div className={`cover${small ? ' small' : ''}`} style={{ ['--cover' as string]: bg, ['--cover-ink' as string]: ink }}>
      {title}
    </div>
  );
}
export const charsLabel = (n?: number) => (n ? `${fmtNum(n)}자` : '빈 책');
