// 인쇄용 PDF 설정 칸 (내보내기 창): 글꼴 · 판형 · 글자 · 장 시작 · 대사 · 쪽 번호
import { SIZES } from '../lib/typeset/layout';
import { FACES, type FaceId, type PrintSettings } from '../lib/typeset/settings';
import { FacePicker } from './FacePicker';

function Seg<T extends string | number | boolean>({ value, opts, onChange, near }: { value: T; opts: readonly (readonly [T, string])[]; onChange: (v: T) => void; near?: boolean }) {
  return (
    <div className="seg">
      {opts.map(([v, l]) => (
        <button key={String(v)} className={(near ? Math.abs(Number(value) - Number(v)) < 0.005 : value === v) ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function PrintPanel({ ps, setP }: { ps: PrintSettings; setP: (p: Partial<PrintSettings>) => void }) {
  const faces = Object.entries(FACES) as [FaceId, (typeof FACES)[FaceId]][];
  return (
    <div className="ai-card">
      <div className="field">
        본문 글꼴
        <FacePicker value={ps.face} onChange={(face) => setP({ face })} />
      </div>
      <label className="field">
        제목 글꼴 <span className="faint tiny">표제지 · 부 · 장 · 소제목에 써요</span>
        <select className="input" value={ps.headFace} onChange={(e) => setP({ headFace: e.target.value as PrintSettings['headFace'] })} style={{ maxWidth: 280 }}>
          <option value="same">본문과 같게</option>
          {faces.map(([id, f]) => (
            <option key={id} value={id}>
              {f.name} ({f.kind} · {f.mb}MB)
            </option>
          ))}
        </select>
      </label>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="field">
          판형
          <select className="input" value={ps.size} onChange={(e) => setP({ size: e.target.value as PrintSettings['size'] })}>
            {Object.entries(SIZES).map(([id, s]) => (
              <option key={id} value={id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          글자 크기
          <Seg
            value={ps.font}
            opts={[
              ['small', '작게'],
              ['normal', '보통'],
              ['large', '크게'],
            ] as const}
            onChange={(font) => setP({ font })}
          />
        </div>
        <div className="field">
          줄 간격
          <Seg
            near
            value={ps.leading}
            opts={[
              [1.64, '좁게'],
              [1.78, '보통'],
              [1.95, '넓게'],
            ] as const}
            onChange={(leading) => setP({ leading })}
          />
        </div>
        <div className="field">
          자간
          <Seg
            near
            value={ps.tracking}
            opts={[
              [-0.01, '좁게'],
              [0, '보통'],
              [0.01, '넓게'],
            ] as const}
            onChange={(tracking) => setP({ tracking })}
          />
        </div>
        <div className="field">
          주석 표시
          <Seg
            value={ps.noteStyle}
            opts={[
              ['star', '* 별표'],
              ['number', '1 숫자'],
            ] as const}
            onChange={(noteStyle) => setP({ noteStyle })}
          />
        </div>
      </div>
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>
          장 시작 · 대사 · 쪽 번호 서식
        </summary>
        <div className="stack" style={{ gap: 10, marginTop: 8 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="field">
              장 제목 위치
              <Seg
                value={ps.chapterAlign}
                opts={[
                  ['center', '가운데'],
                  ['left', '왼쪽 + 짧은 선'],
                ] as const}
                onChange={(chapterAlign) => setP({ chapterAlign })}
              />
            </div>
            <div className="field">
              장 시작 높이
              <Seg
                value={ps.chapterDrop}
                opts={[
                  ['normal', '위쪽'],
                  ['low', '아래로 내려서'],
                ] as const}
                onChange={(chapterDrop) => setP({ chapterDrop })}
              />
            </div>
            <div className="field">
              장 번호 (「1장 바람」 꼴 제목)
              <Seg
                value={ps.chapterNumber}
                opts={[
                  ['asis', '쓴 그대로'],
                  ['plain', '1 / 바람'],
                  ['je', '제1장 / 바람'],
                ] as const}
                onChange={(chapterNumber) => setP({ chapterNumber })}
              />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={ps.firstIndent} onChange={(e) => setP({ firstIndent: e.target.checked })} />장 첫 문단도 들여쓰기 (끄면 첫 문단만 붙여서 시작)
          </label>
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="field">
              따옴표 모양
              <Seg
                value={ps.quotes}
                opts={[
                  ['keep', '쓴 그대로'],
                  ['curly', '“ ” ‘ ’'],
                  ['corner', '「 」 『 』'],
                ] as const}
                onChange={(quotes) => setP({ quotes })}
              />
            </div>
            <div className="field">
              대사 문단 (따옴표로 시작)
              <Seg
                value={ps.dialogue}
                opts={[
                  ['indent', '들여쓰기'],
                  ['flush', '붙여서 시작'],
                ] as const}
                onChange={(dialogue) => setP({ dialogue })}
              />
            </div>
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="field">
              쪽 번호 위치
              <Seg
                value={ps.pageNo}
                opts={[
                  ['outer', '바깥 아래'],
                  ['center', '가운데 아래'],
                  ['none', '없음'],
                ] as const}
                onChange={(pageNo) => setP({ pageNo })}
              />
            </div>
            <div className="field">
              쪽 번호 모양
              <Seg
                value={ps.pageFmt}
                opts={[
                  ['plain', '12'],
                  ['dash', '- 12 -'],
                  ['dot', '· 12 ·'],
                ] as const}
                onChange={(pageFmt) => setP({ pageFmt })}
              />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={ps.romanFront} onChange={(e) => setP({ romanFront: e.target.checked })} />
            목차 같은 앞붙이는 로마 숫자(i, ii)로 세고, 첫 장을 1쪽으로 (목차 쪽수도 그에 맞춰요)
          </label>
        </div>
      </details>
      <label className="check">
        <input type="checkbox" checked={ps.rightStart} onChange={(e) => setP({ rightStart: e.target.checked })} />장 · 부를 오른쪽(홀수) 쪽에서 시작 (책에서 흔한 방식, 필요하면 빈 쪽을 넣어요)
      </label>
      <label className="check">
        <input type="checkbox" checked={ps.heads} onChange={(e) => setP({ heads: e.target.checked })} />
        머리글 (왼쪽 쪽에 책 제목, 오른쪽 쪽에 장 제목)
      </label>
      <label className="check">
        <input type="checkbox" checked={ps.multipleOf4} onChange={(e) => setP({ multipleOf4: e.target.checked })} />
        전체 쪽수를 4의 배수로 (제본용, 판권면 앞에 빈 쪽)
      </label>
      <label className="check">
        <input type="checkbox" checked={ps.bleed} onChange={(e) => setP({ bleed: e.target.checked })} />
        도련(재단 여백) 사방 3mm 넣기 — 인쇄소가 요구할 때만
      </label>
      <p className="faint tiny" style={{ margin: 0 }}>
        글꼴은 모두 상업 인쇄에 써도 되는 오픈 라이선스이고, 책에 쓴 글자만 PDF 안에 넣어 어느 인쇄소에서 열어도 같게 나와요. 한자를 쓰면 본명조 · 본고딕을 고르세요(다른 글꼴은 한자를 □ 로 바꿔요). 표지는 책등 두께가 쪽수 · 종이에 따라 달라 따로 만들어야 해요. 인쇄소마다 요구(도련 · 판형 · 색 방식)가 다르니 보내기 전에 그곳 안내를 한 번 확인해 주세요.
      </p>
    </div>
  );
}
