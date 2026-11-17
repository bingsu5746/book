// 원고 편집기 (CodeMirror 6 + 마크다운)
// - 쓰면서 제목 · 강조 · 인용이 글 모양 그대로 보인다
// - [[세계관 항목]] 링크: 자동 완성 · 마우스를 올리면 요약 카드 · 없는 항목은 빨간 점선
// - %%작가 메모%%: 리더 · 공유본에는 안 보이는 메모
// - 집중 모드(지금 문단만 진하게) · 타자기 모드(쓰는 줄을 화면 가운데)
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, drawSelection, EditorView, hoverTooltip, keymap, placeholder, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { openSearchPanel, search, searchKeymap, SearchQuery, setSearchQuery } from '@codemirror/search';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';

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
    for (const m of text.matchAll(MEMO)) b.push({ from: from + m.index!, to: from + m.index! + m[0].length, d: Decoration.mark({ class: 'cm-memo' }) });
    if (dialogue) for (const m of text.matchAll(DIALOGUE)) b.push({ from: from + m.index!, to: from + m.index! + m[0].length, d: Decoration.mark({ class: 'cm-dialogue' }) });
  }
  b.sort((x, y) => x.from - y.from || x.to - y.to);
  const rs = new RangeSetBuilder<Decoration>();
  for (const x of b) rs.add(x.from, x.to, x.d);
  return rs.finish();
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
  onLinkClick?: (name: string) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modes = useRef({ focus: new Compartment(), tw: new Compartment(), deco: new Compartment() });

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
      if (!m) return null;
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
          placeholder('여기에 쓰세요. [[ 를 치면 세계관 항목을 불러올 수 있어요.'),
          modes.current.deco.of(decoExt(nameSet(p.entries), p.dialogueTint)),
          modes.current.focus.of(p.focusMode ? focusPlugin : []),
          modes.current.tw.of(p.typewriterMode ? typewriter : []),
          keymap.of([
            { key: 'Mod-b', run: (v) => (wrapSel(v, '**'), true) },
            { key: 'Mod-i', run: (v) => (wrapSel(v, '*'), true) },
            { key: 'Mod-k', run: (v) => (wrapSel(v, '[[', ']]'), true) },
            { key: 'Mod-/', run: (v) => (wrapSel(v, '%%', '%%'), true) },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) propsRef.current.onChange(u.state.doc.toString());
            if (u.selectionSet) {
              const r = u.state.selection.main;
              propsRef.current.onSelection?.(r.empty ? 0 : u.state.sliceDoc(r.from, r.to).replace(/\s/g, '').length);
            }
          }),
          EditorView.domEventHandlers({
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
  }));

  return <div className="ed-main" ref={host} />;
});
