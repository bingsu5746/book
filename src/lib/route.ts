// 이야기 이동 경로: 장마다 정한 장소(장 정보 「장소」)를 지도 핀과 이어, 책 순서대로 점을 찍는다.
export interface RoutePoint {
  pinId: string;
  x: number;
  y: number;
  place: string;
  chapters: { id: string; i: number; title: string }[];
}

export function storyRoute(
  chapters: { id: string; title: string; place: string }[],
  pins: { id: string; x: number; y: number; entry: string; label: string }[],
  entries: { id: string; name: string; aliases: string[] }[],
): { points: RoutePoint[]; missing: { i: number; title: string; place: string }[] } {
  const pinFor = (place: string) => {
    const p = place.trim();
    if (!p) return null;
    const e = entries.find((x) => x.name === p || x.aliases.includes(p));
    return pins.find((x) => (e && x.entry === e.id) || (x.label && x.label.trim() === p)) ?? null;
  };
  const points: RoutePoint[] = [];
  const missing: { i: number; title: string; place: string }[] = [];
  chapters.forEach((c, k) => {
    const i = k + 1;
    if (!c.place.trim()) return;
    const pin = pinFor(c.place);
    if (!pin) return void missing.push({ i, title: c.title, place: c.place });
    const last = points[points.length - 1];
    if (last && last.pinId === pin.id) last.chapters.push({ id: c.id, i, title: c.title });
    else points.push({ pinId: pin.id, x: pin.x, y: pin.y, place: c.place.trim(), chapters: [{ id: c.id, i, title: c.title }] });
  });
  return { points, missing };
}
