// 인쇄용 글꼴 손질 (한 번만 돌리면 되는 도구): node --experimental-strip-types scripts/print-fonts.mts <받은 글꼴 폴더>
// 1) 본명조 · 본고딕(구글 폰트의 가변 글꼴 NotoSerifKR[wght].ttf · NotoSansKR[wght].ttf)을 보통(400) · 굵게(700) 두 파일로 고정
// 2) 글꼴 고르기 화면에서 보일 아주 작은 미리 보기 글꼴(public/fonts/preview/*.ttf)을 만든다
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { subsetterFrom } from '../src/lib/typeset/subset.ts';
import { FACES, PREVIEW_TEXT } from '../src/lib/typeset/settings.ts';

const sub = await subsetterFrom(readFileSync(new URL('../node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm', import.meta.url)));
const src = process.argv[2];
const out = new URL('../public/fonts/', import.meta.url);
if (src) {
  for (const name of ['NotoSerifKR', 'NotoSansKR']) {
    const f = `${src}/${name}[wght].ttf`;
    if (!existsSync(f)) continue;
    const bytes = readFileSync(f);
    writeFileSync(new URL(`${name}-Regular.ttf`, out), sub(bytes, { wght: 400 }));
    writeFileSync(new URL(`${name}-Bold.ttf`, out), sub(bytes, { wght: 700 }));
    console.log('고정', name);
  }
}
mkdirSync(new URL('preview/', out), { recursive: true });
for (const f of Object.values(FACES)) {
  const bytes = sub(readFileSync(new URL(`${f.file}-Regular.ttf`, out)), { text: f.name + PREVIEW_TEXT });
  writeFileSync(new URL(`preview/${f.file}.ttf`, out), bytes);
  console.log('미리 보기', f.file, bytes.length);
}
