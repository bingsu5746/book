// 인쇄용 PDF 에 넣을 그림을 받는다. PDF 는 JPEG · PNG 만 넣을 수 있어서, 그 밖(WebP 등)은 JPEG 로 바꾼다.
export async function loadImages(srcs: string[]): Promise<Map<string, { bytes: Uint8Array; mime: string; w: number; h: number }>> {
  const out = new Map<string, { bytes: Uint8Array; mime: string; w: number; h: number }>();
  for (const src of [...new Set(srcs)]) {
    try {
      const r = await fetch(src, { credentials: 'same-origin' });
      if (!r.ok) continue;
      let blob = await r.blob();
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      if (blob.type !== 'image/jpeg' && blob.type !== 'image/png') {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.drawImage(bmp, 0, 0);
        blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('그림을 바꾸지 못했어요'))), 'image/jpeg', 0.92));
      }
      bmp.close();
      out.set(src, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, w, h });
    } catch {
      /* 못 받은 그림은 빼고 */
    }
  }
  return out;
}
export const imageSrcs = (bodies: string[]) => bodies.flatMap((b) => [...b.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]));
