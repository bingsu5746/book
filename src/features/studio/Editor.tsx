// 원고 편집기 (CodeMirror 6 + 마크다운)
// - 쓰면서 제목 · 강조 · 인용이 글 모양 그대로 보인다
// - [[세계관 항목]] 링크: 자동 완성 · 마우스를 올리면 요약 카드 · 없는 항목은 빨간 점선
// - %%작가 메모%%: 리더 · 공유본에는 안 보이는 메모
// - 집중 모드(지금 문단만 진하게) · 타자기 모드(쓰는 줄을 화면 가운데)
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, drawSelection, EditorView, hoverTooltip, keymap, placeholder, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { openSearchPanel, search, searchKeymap, SearchQuery, setSearchQuery } from '@codemirror/search';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { BEAT_LINE, beatLine } from '../../lib/beats';

export interface EntryRef {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  summary: string;
  color?: string;
}

export interface EditorHandle {
  view: EditorView | null;
  wrap: (before: string, after?: string) => void;
  insertLine: (text: string) => void;
  select: (from: number, to: number) => void;
  find: (q: string) => void;
  setMarks: (m: { from: number; to: number; cls: string }[]) => void;
  focus: () => void;
  insertText: (t: string) => void;
  insertBeat: (text?: string) => void;
}

const style = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-h1' },
  { tag: t.heading2, class: 'cm-h2' },
  { tag: t.heading3, class: 'cm-h3' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.quote, class: 'cm-quote' },
  { tag: t.processingInstruction, class: 'cm-md-mark' },
  { tag: t.contentSeparator, class: 'cm-md-mark' },
]);

const WL = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;
const MEMO = /%%[\s\S]*?%%/g;
const DIALOGUE = /“[^”\n]*”|"[^"\n]*"|「[^」\n]*」|『[^』\n]*』/g;

function buildDecos(view: EditorView, names: Set<string>, dialogue: boolean): DecorationSet {
  const b: { from: number; to: number; d: Decoration }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(WL)) b.push({ from: from + m.index!, to: from + m.index! + m[0].length, d: Decoration.mark({ class: names.has(m[1].trim()) ? 'cm-wl' : 'cm-wl-missing' }) });
    for (const m of text.matchAll(MEMO)) {
      const a = from + m.index!;
      const z = a + m[0].length;
      const line = view.state.doc.lineAt(a);
      if (line.from === a && line.to === z && BEAT_LINE.test(line.text)) {
        // 쪽 줄거리: 줄 전체를 안내 카드로, 표시 기호는 흐리게
        b.push({ from: a, to: a, d: Decoration.line({ class: 'cm-beat' }) });
        b.push({ from: a, to: a + 3, d: Decoration.mark({ class: 'cm-beat-sym' }) });
        b.push({ from: z - 2, to: z, d: Decoration.mark({ class: 'cm-beat-sym' }) });
      } else b.push({ from: a, to: z, d: Decoration.mark({ class: 'cm-memo' }) });
    }
    if (dialogue) for (const m of text.matchAll(DIALOGUE)) b.push({ from: from + m.index!, to: from + m.index! + m[0].length, d: Decoration.mark({ class: 'cm-dialogue' }) });
  }
  return Decoration.set(
    b.map((x) => x.d.range(x.from, x.to)),
    true,
  );
}

/** 커서 자리에 쪽 줄거리 줄을 넣는다 (빈 줄이면 그 줄에, 아니면 문단 뒤에) */
function insertBeatAt(v: EditorView, text = ''): boolean {
  const head = v.state.selection.main.head;
  let line = v.state.doc.lineAt(head);
  const mark = beatLine(text || ' ').replace(/ %%$/, ' %%');
  if (!line.text.trim()) {
    const ins = mark;
    v.dispatch({ changes: { from: line.from, to: line.to, insert: ins + '\n' }, selection: { anchor: line.from + ins.length - 2 } });
    return true;
  }
  // 문단 끝까지 내려가서 그 뒤에
  while (line.number < v.state.doc.lines && v.state.doc.line(line.number + 1).text.trim()) line = v.state.doc.line(line.number + 1);
  const ins = `\n\n${mark}\n`;
  v.dispatch({ changes: { from: line.to, insert: ins }, selection: { anchor: line.to + 2 + mark.length - 2 }, effects: EditorView.scrollIntoView(line.to, { y: 'center' }) });
  return true;
}

/** 집중 모드: 커서가 있는 문단(빈 줄 사이) 말고는 흐리게 */
const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) {
      this.decorations = this.build(v);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(v: EditorView) {
      const doc = v.state.doc;
      const cur = doc.lineAt(v.state.selection.main.head).number;
      let a = cur;
      let z = cur;
      while (a > 1 && doc.line(a - 1).text.trim()) a--;
      while (z < doc.lines && doc.line(z + 1).text.trim()) z++;
      const rs = new RangeSetBuilder<Decoration>();
      const dim = Decoration.line({ class: 'cm-dim' });
      for (const { from, to } of v.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = doc.lineAt(pos);
          if (line.number < a || line.number > z) rs.add(line.from, line.from, dim);
          pos = line.to + 1;
        }
      }
      return rs.finish();
    }
  },
  { decorations: (p) => p.decorations },
);

const typewriter = EditorView.updateListener.of((u) => {
  if (!u.selectionSet && !u.docChanged) return;
  const head = u.state.selection.main.head;
  requestAnimationFrame(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) }));
});

const setMarksEffect = StateEffect.define<{ from: number; to: number; cls: string }[]>();
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setMarksEffect)) {
        const len = tr.state.doc.length;
        const items = e.value.filter((m) => m.from < m.to && m.to <= len).sort((a, b) => a.from - b.from);
        v = Decoration.set(items.map((m) => Decoration.mark({ class: m.cls }).range(m.from, m.to)));
      }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// 원고 속 사진: 「![설명](/api/bimg/…)」 줄 아래에 그림을 작게 보여 준다
class ImgWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(o: ImgWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM() {
    const d = document.createElement('div');
    d.className = 'cm-img-prev';
    const i = document.createElement('img');
    i.src = this.src;
    i.alt = this.alt;
    i.loading = 'lazy';
    d.appendChild(i);
    if (this.alt) {
      const c = document.createElement('span');
      c.textContent = this.alt;
      d.appendChild(c);
    }
    return d;
  }
  ignoreEvent() {
    return true;
  }
}
const IMG_LINE = /^!\[([^\]]*)\]\((\/api\/bimg\/[a-z0-9]+|https:\/\/[^)\s]+)(?:\s+"\d+x\d+")?\)\s*$/;
function imgDecos(doc: Text): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  if (!doc.toString().includes('![')) return b.finish();
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const m = l.text.match(IMG_LINE);
    if (m) b.add(l.to, l.to, Decoration.widget({ widget: new ImgWidget(m[2], m[1]), block: true, side: 1 }));
  }
  return b.finish();
}
const imgField = StateField.define<DecorationSet>({
  create: (s) => imgDecos(s.doc),
  update: (v, tr) => (tr.docChanged ? imgDecos(tr.state.doc) : v),
  provide: (f) => EditorView.decorations.from(f),
});

function wrapSel(view: EditorView, before: string, after = before) {
  const tr = view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length)
      return { changes: { from: r.from, to: r.to, insert: text.slice(before.length, text.length - after.length) }, range: EditorSelection.range(r.from, r.to - before.length - after.length) };
    return { changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }], range: EditorSelection.range(r.from + before.length, r.to + before.length) };
  });
  view.dispatch(tr);
  view.focus();
}

export interface EditorProps {
  doc: string;
  onChange: (doc: string) => void;
  onSelection?: (chars: number) => void;
  entries: EntryRef[];
  focusMode: boolean;
  typewriterMode: boolean;
  dialogueTint: boolean;
  /** 세계관 이름 자동 완성 ([[ 없이 두 글자부터) */
  nameComplete?: boolean;
  /** " ' 를 치면 둥근 따옴표로 */
  smartQuotes?: boolean;
  onLinkClick?: (name: string) => void;
  /** 글을 고르면 그 자리(화면 좌표) — 서식 말풍선을 띄우려고 */
  onSelectRect?: (r: { x: number; y: number } | null) => void;
  /** 긴 글을 붙여넣었을 때 (정리할지 물으려고) */
  onPasted?: (from: number, to: number, text: string) => void;
  /** 커서가 옮겨질 때 (지금 쓰는 쪽 줄거리를 보여 주려고) */
  onCursor?: (pos: number, doc: string) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modes = useRef({ focus: new Compartment(), tw: new Compartment(), deco: new Compartment(), quotes: new Compartment() });
  const quoteExt = EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '"' && text !== "'") return false;
    const prev = view.state.sliceDoc(Math.max(0, from - 1), from);
    const open = !prev || /[\s(\[{“‘「『—-]/.test(prev);
    const q = text === '"' ? (open ? '“' : '”') : open ? '‘' : '’';
    view.dispatch({ changes: { from, to, insert: q }, selection: { anchor: from + 1 } });
    return true;
  });

  const decoExt = (names: Set<string>, dialogue: boolean): Extension =>
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(v: EditorView) {
          this.decorations = buildDecos(v, names, dialogue);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) this.decorations = buildDecos(u.view, names, dialogue);
        }
      },
      { decorations: (p) => p.decorations },
    );
  const nameSet = (es: EntryRef[]) => new Set(es.flatMap((e) => [e.name, ...e.aliases]).map((x) => x.trim()));

  useEffect(() => {
    const p = propsRef.current;
    const findEntry = (name: string) => {
      const n = name.trim();
      return propsRef.current.entries.find((e) => e.name === n || e.aliases.includes(n));
    };
    const complete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*/);
      if (!m) {
        // [[ 없이: 세계관 이름의 앞 두 글자 이상을 치면 이름을 권한다
        if (!propsRef.current.nameComplete) return null;
        const w = ctx.matchBefore(/[가-힣A-Za-z0-9]{2,}$/);
        if (!w) return null;
        const typed = w.text;
        const opts = propsRef.current.entries.flatMap((e) => [e.name, ...e.aliases].filter((n) => n.length > typed.length && n.startsWith(typed)).map((n) => ({ label: n, detail: e.type })));
        return opts.length ? { from: w.from, options: opts, validFor: /^[가-힣A-Za-z0-9]*$/ } : null;
      }
      return {
        from: m.from + 2,
        options: propsRef.current.entries.flatMap((e) => [
          { label: e.name, detail: e.type, apply: `${e.name}]]` },
          ...e.aliases.map((a) => ({ label: a, detail: `${e.name}의 다른 이름`, apply: `${a}]]` })),
        ]),
        validFor: /^[^\]\n]*$/,
      };
    };
    const tip = hoverTooltip((view, pos) => {
      const line = view.state.doc.lineAt(pos);
      for (const m of line.text.matchAll(WL)) {
        const a = line.from + m.index!;
        const b = a + m[0].length;
        if (pos < a || pos > b) continue;
        const e = findEntry(m[1]);
        return {
          pos: a,
          end: b,
          above: true,
          create: () => {
            const dom = document.createElement('div');
            dom.className = 'wl-tip';
            const title = document.createElement('b');
            title.textContent = e ? e.name : m[1];
            const body = document.createElement('div');
            body.textContent = e ? `${e.type}${e.summary ? ' · ' + e.summary : ''}` : '세계관에 아직 없는 이름이에요. 눌러서 만들 수 있어요.';
            dom.append(title, body);
            return { dom };
          },
        };
      }
      return null;
    });
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.doc,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(style),
          search({ top: true }),
          autocompletion({ override: [complete], activateOnTyping: true, icons: false }),
          tip,
          marksField,
          imgField,
          placeholder('여기에 쓰세요. [[ 를 치면 세계관 항목을 불러올 수 있어요.'),
          modes.current.deco.of(decoExt(nameSet(p.entries), p.dialogueTint)),
          modes.current.focus.of(p.focusMode ? focusPlugin : []),
          modes.current.tw.of(p.typewriterMode ? typewriter : []),
          modes.current.quotes.of(p.smartQuotes ? quoteExt : []),
          keymap.of([
            { key: 'Mod-b', run: (v) => (wrapSel(v, '**'), true) },
            { key: 'Mod-i', run: (v) => (wrapSel(v, '*'), true) },
            { key: 'Mod-k', run: (v) => (wrapSel(v, '[[', ']]'), true) },
            { key: 'Mod-/', run: (v) => (wrapSel(v, '%%', '%%'), true) },
            { key: 'Mod-Enter', run: (v) => insertBeatAt(v) },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) propsRef.current.onChange(u.state.doc.toString());
            if (u.docChanged && propsRef.current.onPasted)
              for (const tr of u.transactions)
                if (tr.isUserEvent('input.paste'))
                  tr.changes.iterChanges((_fa, _ta, fb, tb, ins) => {
                    if (ins.length >= 200) propsRef.current.onPasted?.(fb, tb, ins.toString());
                  });
            if (u.selectionSet || u.docChanged) propsRef.current.onCursor?.(u.state.selection.main.head, u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const r = u.state.selection.main;
              propsRef.current.onSelection?.(r.empty ? 0 : u.state.sliceDoc(r.from, r.to).replace(/\s/g, '').length);
              const cb = propsRef.current.onSelectRect;
              if (cb) {
                if (r.empty) cb(null);
                else
                  requestAnimationFrame(() => {
                    const a = u.view.coordsAtPos(r.from);
                    const b = u.view.coordsAtPos(r.to);
                    if (!a || !b) return cb(null);
                    cb({ x: a.top === b.top ? (a.left + b.left) / 2 : a.left + 60, y: a.top });
                  });
              }
            }
          }),
          EditorView.domEventHandlers({
            scroll: () => {
              propsRef.current.onSelectRect?.(null);
              return false;
            },
            blur: () => {
              setTimeout(() => propsRef.current.onSelectRect?.(null), 150);
              return false;
            },
            mousedown: (e, v) => {
              if (!(e.metaKey || e.ctrlKey)) return false;
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return false;
              const line = v.state.doc.lineAt(pos);
              for (const m of line.text.matchAll(WL)) {
                const a = line.from + m.index!;
                if (pos >= a && pos <= a + m[0].length) {
                  propsRef.current.onLinkClick?.(m[1].trim());
                  e.preventDefault();
                  return true;
                }
              }
              return false;
            },
          }),
          EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', 'aria-label': '원고' }),
        ],
      }),
    });
    viewRef.current = view;
    return () => view.destroy();
    // 장이 바뀌면 부모가 key 로 새로 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: modes.current.focus.reconfigure(props.focusMode ? focusPlugin : []) });
  }, [props.focusMode]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: modes.current.tw.reconfigure(props.typewriterMode ? typewriter : []) });
  }, [props.typewriterMode]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: modes.current.quotes.reconfigure(props.smartQuotes ? quoteExt : []) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.smartQuotes]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: modes.current.deco.reconfigure(decoExt(nameSet(props.entries), props.dialogueTint)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entries, props.dialogueTint]);

  useImperativeHandle(ref, () => ({
    get view() {
      return viewRef.current;
    },
    wrap: (b, a) => viewRef.current && wrapSel(viewRef.current, b, a),
    insertLine: (text) => {
      const v = viewRef.current;
      if (!v) return;
      const line = v.state.doc.lineAt(v.state.selection.main.head);
      const insert = (line.text.trim() ? '\n\n' : '') + text + '\n\n';
      const at = line.text.trim() ? line.to : line.from;
      v.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
      v.focus();
    },
    select: (from, to) => {
      const v = viewRef.current;
      if (!v) return;
      const len = v.state.doc.length;
      const a = Math.min(from, len);
      const b = Math.min(to, len);
      v.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
      v.focus();
    },
    find: (q) => {
      const v = viewRef.current;
      if (!v) return;
      openSearchPanel(v);
      v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: q })) });
      const i = v.state.doc.toString().indexOf(q);
      if (i >= 0) v.dispatch({ selection: { anchor: i, head: i + q.length }, effects: EditorView.scrollIntoView(i, { y: 'center' }) });
    },
    setMarks: (m) => viewRef.current?.dispatch({ effects: setMarksEffect.of(m) }),
    focus: () => viewRef.current?.focus(),
    insertBeat: (text) => {
      const v = viewRef.current;
      if (!v) return;
      insertBeatAt(v, text);
      v.focus();
    },
    insertText: (t) => {
      const v = viewRef.current;
      if (!v) return;
      const r = v.state.selection.main;
      const before = v.state.sliceDoc(Math.max(0, r.from - 1), r.from);
      const text = (before && !/\s/.test(before) ? ' ' : '') + t;
      v.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length }, scrollIntoView: true });
    },
  }));

  return <div className="ed-main" ref={host} />;
});
