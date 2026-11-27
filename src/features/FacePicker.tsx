// 인쇄용 글꼴 고르기: 글꼴마다 이름과 보기 글을 그 글꼴로 보여 준다 (아주 작은 미리 보기 글꼴만 받는다)
import { useEffect } from 'react';
import { FACES, PREVIEW_TEXT, type FaceId } from '../lib/typeset/settings';

const loaded = new Set<string>();
function usePreviewFonts() {
  useEffect(() => {
    for (const f of Object.values(FACES)) {
      if (loaded.has(f.file) || typeof FontFace === 'undefined') continue;
      loaded.add(f.file);
      new FontFace(`pv-${f.file}`, `url(/fonts/preview/${f.file}.ttf)`)
        .load()
        .then((ff) => document.fonts.add(ff))
        .catch(() => loaded.delete(f.file));
    }
  }, []);
}

export function FacePicker({ value, onChange }: { value: FaceId; onChange: (id: FaceId) => void }) {
  usePreviewFonts();
  return (
    <div className="face-list" role="radiogroup" aria-label="본문 글꼴">
      {(Object.entries(FACES) as [FaceId, (typeof FACES)[FaceId]][]).map(([id, f]) => (
        <button key={id} role="radio" aria-checked={value === id} className={`face-opt${value === id ? ' on' : ''}`} onClick={() => onChange(id)}>
          <span className="face-name" style={{ fontFamily: `pv-${f.file}, var(--${f.kind === '명조' ? 'serif' : 'sans'})` }}>
            {f.name}
          </span>
          <span className="face-sample" style={{ fontFamily: `pv-${f.file}, var(--${f.kind === '명조' ? 'serif' : 'sans'})` }}>
            {f.hanja ? PREVIEW_TEXT : PREVIEW_TEXT.replace(/\s*漢字$/, '')}
          </span>
          <span className="face-meta">
            {f.kind} · {f.note} · {f.hanja ? '한자 있음' : '한자 없음'} · {f.mb}MB
          </span>
        </button>
      ))}
    </div>
  );
}
