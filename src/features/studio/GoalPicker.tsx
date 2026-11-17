// 책 목표 분량 고르기: 흔한 길이(공모 요강의 예)를 보여 주고, 공백 뺀 글자 목표로 바꾼다.
import { useState } from 'react';
import { LENGTH_PRESETS, pagesToChars } from '../../lib/goals';
import { fmtNum } from '../../lib/text';

export function GoalPicker({ value, onChange, per, own }: { value: number; onChange: (chars: number) => void; per: number; own: boolean }) {
  const [custom, setCustom] = useState(false);
  const picked = LENGTH_PRESETS.find((p) => pagesToChars(p.pages, per) === value);
  return (
    <div className="goal-pick">
      <div className="goal-list">
        <button className={`goal-opt${!value ? ' on' : ''}`} onClick={() => (setCustom(false), onChange(0))}>
          <b>정하지 않음</b>
          <span className="faint tiny">나중에 정해도 돼요</span>
        </button>
        {LENGTH_PRESETS.map((p) => (
          <button key={p.id} className={`goal-opt${picked?.id === p.id && !custom ? ' on' : ''}`} onClick={() => (setCustom(false), onChange(pagesToChars(p.pages, per)))} title={p.source}>
            <b>{p.name}</b>
            <span className="small">{p.range}</span>
            <span className="faint tiny">≈ 공백 빼고 {fmtNum(pagesToChars(p.pages, per))}자</span>
          </button>
        ))}
        <button className={`goal-opt${custom || (value && !picked) ? ' on' : ''}`} onClick={() => setCustom(true)}>
          <b>직접</b>
          <span className="faint tiny">글자 수로 정하기</span>
        </button>
      </div>
      {(custom || (!!value && !picked)) && (
        <label className="field">
          목표 (공백 뺀 글자)
          <input className="input" type="number" min={0} step={1000} defaultValue={value || ''} onBlur={(e) => onChange(Math.max(0, Math.floor(+e.target.value || 0)))} />
        </label>
      )}
      <p className="faint tiny">
        분량은 공모 요강에 나온 예예요(곳마다 · 해마다 달라요. 단추에 마우스를 올리면 어디 요강인지 보여요). 원고지 1매 ≈ 공백 빼고 {per}자로 바꿨어요 — {own ? '이 책 원고로 잰 값' : '「새벽을 건너는 꿈」 원고로 잰 값'}이고, 실제 원고지는 문단 끝 빈칸까지 세서 매수가 더 나와요.
      </p>
    </div>
  );
}
