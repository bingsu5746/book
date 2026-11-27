// 글꼴 줄이기 (harfbuzz hb-subset, WebAssembly). 쓴 글자만 남기고, 굵기를 바꿀 수 있는 글꼴(가변 글꼴)은 한 굵기로 고정한다.
// pdf-lib 의 자체 subset 은 한글 글꼴에서 글자를 빠뜨려서, 여기서 줄인 글꼴을 pdf-lib 에는 통째로(subset:false) 넣는다.
// 화면에서는 wasm 을 주소로 받고(loadSubsetter), 시험(Node)에서는 파일을 읽어 넘긴다(subsetterFrom).

interface HB {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(p: number, n: number, mode: number, u: number, d: number): number;
  hb_blob_destroy(b: number): void;
  hb_face_create(b: number, i: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_blob_get_data(b: number, n: number): number;
  hb_blob_get_length(b: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_get_flags(i: number): number;
  hb_subset_input_set_flags(i: number, f: number): void;
  hb_subset_input_pin_axis_location(i: number, face: number, tag: number, v: number): number;
  hb_subset_or_fail(face: number, i: number): number;
  hb_set_add(s: number, v: number): void;
  hb_set_clear(s: number): void;
  hb_set_invert(s: number): void;
  _initialize(): void;
}

const tag = (s: string) => [...s].reduce((a, c) => ((a << 8) + c.charCodeAt(0)) >>> 0, 0);
const MEMORY_MODE_WRITABLE = 2;
const SETS_LAYOUT_FEATURE_TAG = 6;
const FLAG_NO_HINTING = 0x1;

export type Subsetter = (font: Uint8Array, opts: { text?: string; wght?: number }) => Uint8Array;

export async function subsetterFrom(wasm: BufferSource | Response): Promise<Subsetter> {
  const { instance } =
    wasm instanceof Response ? await WebAssembly.instantiateStreaming(wasm, {}).catch(async () => WebAssembly.instantiate(await wasm.clone().arrayBuffer(), {})) : await WebAssembly.instantiate(wasm, {});
  const hb = instance.exports as unknown as HB;
  hb._initialize();
  return (font, { text, wght }) => {
    const input = hb.hb_subset_input_create_or_fail();
    if (!input) throw new Error('글꼴을 줄이지 못했어요 (준비 실패).');
    const buf = hb.malloc(font.byteLength);
    new Uint8Array(hb.memory.buffer).set(font, buf);
    const blob = hb.hb_blob_create(buf, font.byteLength, MEMORY_MODE_WRITABLE, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    try {
      // 글자 모양 규칙(합자 · 세로쓰기 등)은 모두 남긴다
      const feats = hb.hb_subset_input_set(input, SETS_LAYOUT_FEATURE_TAG);
      hb.hb_set_clear(feats);
      hb.hb_set_invert(feats);
      // 인쇄에는 힌팅(작은 화면용 보정)이 필요 없다
      hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | FLAG_NO_HINTING);
      const uni = hb.hb_subset_input_unicode_set(input);
      if (text == null) {
        hb.hb_set_clear(uni);
        hb.hb_set_invert(uni);
      } else for (const c of new Set(text)) hb.hb_set_add(uni, c.codePointAt(0)!);
      if (wght != null && !hb.hb_subset_input_pin_axis_location(input, face, tag('wght'), wght)) throw new Error('이 글꼴은 굵기를 고를 수 없어요.');
      const out = hb.hb_subset_or_fail(face, input);
      if (!out) throw new Error('글꼴을 줄이지 못했어요.');
      const rb = hb.hb_face_reference_blob(out);
      const p = hb.hb_blob_get_data(rb, 0);
      const n = hb.hb_blob_get_length(rb);
      // 끝에 빈 자리를 조금 붙인다: fontkit(pdf-lib)은 빈 글자(띄어쓰기 등)도 글자 머리를 읽으려 해서,
      // 줄인 글꼴에서 빈 글자가 파일 맨 끝에 오면 파일 밖을 읽다 멈춘다 (시험으로 확인)
      const bytes = new Uint8Array(n + 16);
      bytes.set(new Uint8Array(hb.memory.buffer, p, n));
      hb.hb_blob_destroy(rb);
      hb.hb_face_destroy(out);
      if (!n) throw new Error('글꼴을 줄이지 못했어요.');
      return bytes;
    } finally {
      hb.hb_subset_input_destroy(input);
      hb.hb_face_destroy(face);
      hb.free(buf);
    }
  };
}

let sub: Promise<Subsetter> | null = null;
export function loadSubsetter(url: string): Promise<Subsetter> {
  if (!sub) {
    sub = fetch(url).then((r) => {
      if (!r.ok) throw new Error('글꼴 도구를 받지 못했어요. 인터넷 연결을 확인해 주세요.');
      return subsetterFrom(r);
    });
    sub.catch(() => (sub = null));
  }
  return sub;
}
