// 책마다 기억하는 인쇄 설정 (pdf-lib 없이 불러올 수 있게 따로 둔다)
import type { PrintOptions } from './layout';

/** 인쇄용 글꼴 (모두 상업 인쇄 · 파일에 넣기가 허락된 오픈 라이선스, public/fonts 의 OFL-*.txt) */
export const FACES = {
  gowun: { name: '고운바탕', kind: '명조', file: 'GowunBatang', mbR: 8.4, hanja: false, mb: 16.6, note: '류양희 디자인' },
  nanum: { name: '나눔명조', kind: '명조', file: 'NanumMyeongjo', mbR: 3.1, hanja: false, mb: 6.1, note: '네이버' },
  maru: { name: '마루 부리', kind: '명조', file: 'MaruBuri', mbR: 3.3, hanja: false, mb: 6.6, note: '네이버' },
  noto: { name: '본명조', kind: '명조', file: 'NotoSerifKR', mbR: 14.1, hanja: true, mb: 28.2, note: '어도비 · 구글' },
  nanumg: { name: '나눔고딕', kind: '고딕', file: 'NanumGothic', mbR: 2.1, hanja: false, mb: 4.1, note: '네이버' },
  notos: { name: '본고딕', kind: '고딕', file: 'NotoSansKR', mbR: 6.2, hanja: true, mb: 12.4, note: '어도비 · 구글' },
} as const;
/** 글꼴 고르기 화면의 보기 글 (미리 보기 글꼴에 이 글자들만 들어 있다 — 바꾸면 scripts/print-fonts.mts 를 다시 돌린다) */
export const PREVIEW_TEXT = '그날 아침, 바람이 불었다. 1234 漢字';
export type FaceId = keyof typeof FACES;
export const faceFiles = (id: FaceId) => [`/fonts/${FACES[id].file}-Regular.ttf`, `/fonts/${FACES[id].file}-Bold.ttf`] as const;

export interface PrintSettings {
  size: PrintOptions['size'];
  font: PrintOptions['font'];
  face: FaceId;
  rightStart: boolean;
  heads: boolean;
  noteStyle: PrintOptions['noteStyle'];
  multipleOf4: boolean;
  bleed: boolean;
  chapterAlign: NonNullable<PrintOptions['chapterAlign']>;
  chapterDrop: NonNullable<PrintOptions['chapterDrop']>;
  chapterNumber: NonNullable<PrintOptions['chapterNumber']>;
  firstIndent: boolean;
}
export const DEFAULT_PRINT: PrintSettings = { size: 'sinkook', font: 'normal', face: 'gowun', rightStart: true, heads: true, noteStyle: 'star', multipleOf4: true, bleed: false, chapterAlign: 'center', chapterDrop: 'normal', chapterNumber: 'asis', firstIndent: true };
export function printSettingsOf(meta: Record<string, unknown> | undefined): PrintSettings {
  const p = (meta?.print && typeof meta.print === 'object' ? meta.print : {}) as Partial<PrintSettings>;
  const s = { ...DEFAULT_PRINT, ...p };
  if (!(s.face in FACES)) s.face = DEFAULT_PRINT.face;
  return s;
}
