// 받아쓰기: 브라우저의 말 알아듣기(Web Speech API)로 한국어를 글로. 지원하지 않는 브라우저에서는 단추가 보이지 않는다.
type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
const Ctor = (): (new () => Rec) | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const dictationSupported = () => !!Ctor();

/** 받아쓰기를 시작하고, 멈추는 함수를 돌려준다 */
export function startDictation(handlers: { onFinal: (text: string) => void; onInterim: (text: string) => void; onEnd: (error?: string) => void }): () => void {
  const C = Ctor();
  if (!C) {
    handlers.onEnd('이 브라우저는 받아쓰기를 지원하지 않아요.');
    return () => {};
  }
  const rec = new C();
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  let stopped = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) handlers.onFinal(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    handlers.onInterim(interim);
  };
  rec.onerror = (e) => {
    stopped = true;
    handlers.onEnd(e.error === 'not-allowed' ? '마이크를 쓸 수 있게 허락해 주세요.' : e.error === 'no-speech' ? undefined : '받아쓰기가 멈췄어요.');
  };
  // 조용히 있으면 브라우저가 스스로 멈춘다 → 사용자가 멈추기 전까지 다시 켠다
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
        return;
      } catch {
        /* 다시 켜지지 않음 */
      }
    }
    handlers.onEnd();
  };
  rec.start();
  return () => {
    stopped = true;
    rec.stop();
  };
}
