// 완성 예측: 최근 14일에 쓴 글자로 남은 분량이 언제 채워질지 어림한다.
export interface Forecast {
  /** 남은 글자 */
  remaining: number;
  /** 최근 14일 하루 평균 (쓰지 않은 날 포함) */
  perDay: number;
  /** 최근 14일 중 쓴 날 수 */
  activeDays: number;
  days: number;
  finish: string;
  /** 하루 extra 자 더 쓰면 며칠 당겨지나 */
  extra: number;
  saved: number;
  /** 마감일이 있으면: 마감까지 하루에 써야 하는 글자와, 지금 속도로 맞출 수 있는지 */
  deadline?: { date: string; need: number; onTrack: boolean; daysLeft: number };
}

const fmtDay = (d: Date) => d.toLocaleDateString('sv-SE');
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function forecast(days: { day: string; chars: number }[], total: number, goal: number, now: Date, deadline?: string | null, extra = 500): Forecast | 'done' | null {
  if (goal <= 0) return null;
  const remaining = goal - total;
  if (remaining <= 0) return 'done';
  const since = fmtDay(addDays(now, -13));
  const recent = days.filter((d) => d.day >= since && d.day <= fmtDay(now));
  const sum = recent.reduce((s, d) => s + d.chars, 0);
  const perDay = sum / 14;
  if (perDay <= 0) return null;
  const need = Math.ceil(remaining / perDay);
  const faster = Math.ceil(remaining / (perDay + extra));
  const out: Forecast = { remaining, perDay: Math.round(perDay), activeDays: recent.filter((d) => d.chars > 0).length, days: need, finish: fmtDay(addDays(now, need)), extra, saved: need - faster };
  if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    const end = new Date(`${deadline}T23:59:59`);
    const daysLeft = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
    out.deadline = { date: deadline, need: Math.ceil(remaining / daysLeft), onTrack: fmtDay(addDays(now, need)) <= deadline, daysLeft };
  }
  return out;
}
