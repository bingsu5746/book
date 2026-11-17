import { coverSvg, type CoverStyle } from './cover';
import { fmtNum } from './text';

export function BookCard({ title, by, color, seed, meta, progress, href, onClick, author, coverStyle }: { title: string; by?: string; color?: string; seed: string; meta?: React.ReactNode[]; progress?: number | null; href?: string; onClick?: () => void; author?: string; coverStyle?: string }) {
  const inner = (
    <>
      <span className="thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: coverSvg({ title, author: author ?? by ?? '', color, id: seed, style: coverStyle as CoverStyle | undefined }) }} />
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

/** 그림 표지 주소 (그림이 있고 「글자 표지」를 고르지 않았을 때) */
export const coverUrl = (bookId: string, meta?: Record<string, unknown> | null) => (meta?.coverImage && meta.coverMode !== 'text' ? `/api/books/${bookId}/cover?v=${meta.coverImage}` : null);

export function Cover({ title, color, seed, small, author = '', style, image }: { title: string; color?: string; seed: string; small?: boolean; author?: string; style?: CoverStyle; image?: string | null }) {
  if (image)
    return (
      <div className={`cover img${small ? ' small' : ''}`} role="img" aria-label={`${title} 표지`}>
        <img src={image} alt="" loading="lazy" />
      </div>
    );
  const svg = coverSvg({ title, author, color, id: seed, style });
  return <div className={`cover svg${small ? ' small' : ''}`} role="img" aria-label={`${title} 표지`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
export const charsLabel = (n?: number) => (n ? `${fmtNum(n)}자` : '빈 책');
