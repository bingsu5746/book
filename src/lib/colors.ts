// 표지 색 (바탕, 글자)
export const COVERS: [string, string][] = [
  ['#2f5d50', '#f4efe3'],
  ['#7a3b32', '#f6efe2'],
  ['#34405e', '#ece7dd'],
  ['#8c6b2f', '#fbf3df'],
  ['#5b3a55', '#f1e8ee'],
  ['#3d5c3a', '#eef0e2'],
  ['#9a5a3c', '#fbefe4'],
  ['#283a40', '#e4ecea'],
  ['#6d6a61', '#f4f1ea'],
  ['#c9bfa6', '#2a2620'],
  ['#1f2c4a', '#f2e6c9'],
  ['#4a4540', '#efe9df'],
];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export function coverOf(color: string | undefined, seed: string): [string, string] {
  const hit = COVERS.find(([bg]) => bg === color);
  if (hit) return hit;
  return COVERS[hash(seed) % COVERS.length];
}
