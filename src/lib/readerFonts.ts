// 리더용 글꼴: 인쇄용 글꼴 6가지를 읽을 때도 쓴다 (보통 글씨 파일 하나만 받고, 굵은 글씨는 브라우저가 만든다)
import { FACES, type FaceId } from './typeset/settings';

export const isFace = (v: unknown): v is FaceId => typeof v === 'string' && v in FACES;

const loading = new Map<FaceId, Promise<void>>();
/** 글꼴을 한 번만 받아 브라우저에 등록한다. 못 받으면 실패로 돌려주고 다음에 다시 받아 본다 */
export function loadReaderFace(id: FaceId): Promise<void> {
  let p = loading.get(id);
  if (!p) {
    const f = FACES[id];
    p = new FontFace(`rf-${f.file}`, `url(/fonts/${f.file}-Regular.ttf)`)
      .load()
      .then((ff) => {
        document.fonts.add(ff);
      });
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

/** CSS font-family 값 (받기 전 · 못 받았을 때는 기본 명조 · 고딕) */
export const faceCss = (id: FaceId) => `'rf-${FACES[id].file}', var(--${FACES[id].kind === '명조' ? 'serif' : 'sans'})`;
