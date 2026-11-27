// 그림 줄이기: 기기에서 WebP(안 되면 JPEG)로 줄여 base64 로 보낸다 (서버 한 장 최대 약 1MB)
export async function shrinkImage(file: File, maxDim: number, quality = 0.85, jpeg = false): Promise<{ mime: string; data: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  if (jpeg) {
    // 투명한 곳은 흰 종이로
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  let q = quality;
  for (let i = 0; i < 6; i++) {
    // 원고 속 사진은 인쇄용 PDF 에도 들어가야 해서 JPEG 로 (PDF 는 WebP 를 못 담는다)
    let url = jpeg ? '' : c.toDataURL('image/webp', q);
    let mime = 'image/webp';
    if (!url.startsWith('data:image/webp')) {
      url = c.toDataURL('image/jpeg', q);
      mime = 'image/jpeg';
    }
    const data = url.slice(url.indexOf(',') + 1);
    if (data.length <= 1_350_000) return { mime, data, w, h };
    q -= 0.12;
  }
  throw new Error('그림을 충분히 줄이지 못했어요. 더 작은 그림을 골라 주세요.');
}
