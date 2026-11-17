// 지도: 그림을 올리고 핀을 꽂아 장소 · 인물 항목과 잇는다. 핀 자리는 그림 크기에 대한 비율(0~1)로 저장해서 화면 크기와 상관없다.
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { shrinkImage } from '../../lib/image';
import { confirmBox, Empty, Icon, promptBox, toast } from '../../lib/ui';
import { entriesOf, kindLabel, newItemId, type MapItem, type MapPin, type WItem } from '../../lib/world';

export function WorldMaps({ worldId, items, ro, put, remove }: { worldId: string; items: WItem[]; ro: boolean; put: (i: WItem, now?: boolean) => void; remove: (ids: string[]) => void }) {
  const maps = items.filter((i): i is MapItem => i.type === 'map');
  const [openId, setOpenId] = useState<string | null>(maps[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const open = maps.find((m) => m.id === openId) ?? maps[0] ?? null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const name = await promptBox('지도 이름', file.name.replace(/\.[^.]+$/, ''));
    if (name == null) return;
    setBusy(true);
    try {
      const img = await shrinkImage(file, 2400);
      const r = await api<{ id: string }>(`worlds/${worldId}/images`, { body: { mime: img.mime, data: img.data } });
      const m: MapItem = { id: newItemId(), type: 'map', name: name || '지도', image: r.id, w: img.w, h: img.h, pins: [], note: '' };
      put(m, true);
      setOpenId(m.id);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row wrap">
        {maps.map((m) => (
          <button key={m.id} className={`chip${open?.id === m.id ? ' on' : ''}`} onClick={() => setOpenId(m.id)}>
            {m.name}
          </button>
        ))}
        {!ro && (
          <label className="btn small">
            <Icon name="upload" size={14} />
            {busy ? '올리는 중…' : '지도 그림 올리기'}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        )}
      </div>
      {!open ? (
        <Empty title="지도가 없어요">손으로 그린 지도를 찍은 사진이나 그림 파일을 올리고, 핀을 꽂아 장소 · 인물 항목과 이어 보세요.</Empty>
      ) : (
        <MapView key={open.id} map={open} items={items} ro={ro} worldId={worldId} put={put} remove={remove} />
      )}
    </div>
  );
}

function MapView({ map, items, ro, worldId, put, remove }: { map: MapItem; items: WItem[]; ro: boolean; worldId: string; put: (i: WItem, now?: boolean) => void; remove: (ids: string[]) => void }) {
  const [zoom, setZoom] = useState(1);
  const [placing, setPlacing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const entries = entriesOf(items);
  const save = (m: MapItem) => put(m);
  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const pin = map.pins.find((p) => p.id === sel);
  const pinEntry = pin && entries.find((x) => x.id === pin.entry);

  return (
    <div className="stack">
      <div className="row wrap">
        <b className="serif grow">{map.name}</b>
        <span className="muted small">확대</span>
        <input type="range" min={0.5} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} aria-label="확대" style={{ width: 120, accentColor: 'var(--accent)' }} />
        {!ro && (
          <>
            <button className={`small${placing ? ' primary' : ''}`} onClick={() => setPlacing(!placing)}>
              <Icon name="plus" size={14} />
              {placing ? '그림을 눌러 핀 꽂기…' : '핀 꽂기'}
            </button>
            <button
              className="small ghost"
              onClick={async () => {
                const n = await promptBox('지도 이름', map.name);
                if (n) put({ ...map, name: n }, true);
              }}
            >
              이름
            </button>
            <button
              className="small ghost danger"
              onClick={async () => {
                if (!(await confirmBox(`「${map.name}」 지도를 지울까요?`, { danger: true, ok: '지우기' }))) return;
                await api(`images/${map.image}`, { method: 'DELETE' }).catch(() => {});
                remove([map.id]);
              }}
            >
              지우기
            </button>
          </>
        )}
      </div>
      <div className="map-scroll">
        <div
          ref={box}
          className={`map-box${placing ? ' placing' : ''}`}
          style={{ width: `${zoom * 100}%`, aspectRatio: `${map.w} / ${map.h}` }}
          onClick={(e) => {
            if (!placing || ro) return;
            const p = at(e);
            const np: MapPin = { id: newItemId(), x: p.x, y: p.y, entry: '', label: '' };
            save({ ...map, pins: [...map.pins, np] });
            setPlacing(false);
            setSel(np.id);
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = at(e);
            save({ ...map, pins: map.pins.map((x) => (x.id === drag ? { ...x, ...p } : x)) });
          }}
          onPointerUp={() => setDrag(null)}
        >
          <img src={`/api/images/${map.image}`} alt={map.name} draggable={false} />
          {map.pins.map((p) => {
            const e = entries.find((x) => x.id === p.entry);
            return (
              <button
                key={p.id}
                className={`map-pin${sel === p.id ? ' on' : ''}`}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, ['--c' as string]: e?.color || 'var(--accent)' }}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  setSel(p.id);
                  if (!ro) {
                    (ev.target as Element).setPointerCapture?.(ev.pointerId);
                    setDrag(p.id);
                  }
                }}
                onClick={(ev) => ev.stopPropagation()}
                aria-label={e?.name || p.label || '핀'}
              >
                <span className="dot" />
                <span className="lbl">{e?.name || p.label || '이름 없는 곳'}</span>
              </button>
            );
          })}
        </div>
      </div>
      {pin && (
        <div className="panel stack">
          {ro ? (
            <p>
              <b className="serif">{pinEntry?.name || pin.label}</b> {pinEntry && <span className="muted small">{kindLabel(pinEntry.kind)} · {pinEntry.summary}</span>}
            </p>
          ) : (
            <div className="row wrap">
              <select className="input" style={{ width: 'auto', minWidth: 160 }} value={pin.entry} onChange={(e) => save({ ...map, pins: map.pins.map((x) => (x.id === pin.id ? { ...x, entry: e.target.value } : x)) })} aria-label="이을 항목">
                <option value="">항목과 잇지 않음</option>
                {entries
                  .slice()
                  .sort((a, b) => (a.kind === 'place' ? -1 : 0) - (b.kind === 'place' ? -1 : 0) || a.name.localeCompare(b.name, 'ko'))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({kindLabel(x.kind)})
                    </option>
                  ))}
              </select>
              <input className="input" style={{ width: 180 }} placeholder="이름표 (항목이 없을 때)" defaultValue={pin.label} key={pin.id} onBlur={(e) => save({ ...map, pins: map.pins.map((x) => (x.id === pin.id ? { ...x, label: e.target.value } : x)) })} />
              <button
                className="small danger"
                onClick={() => {
                  save({ ...map, pins: map.pins.filter((x) => x.id !== pin.id) });
                  setSel(null);
                }}
              >
                핀 빼기
              </button>
            </div>
          )}
          {pinEntry && (
            <a className="btn small" style={{ alignSelf: 'flex-start' }} href={`#/worlds/${worldId}/entries/${pinEntry.id}`}>
              {pinEntry.name} 열기
            </a>
          )}
          {!ro && <p className="faint tiny">핀을 끌어 자리를 옮길 수 있어요.</p>}
        </div>
      )}
    </div>
  );
}
