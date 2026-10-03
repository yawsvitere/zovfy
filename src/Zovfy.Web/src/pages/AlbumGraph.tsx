import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/graph.css";
import type { Album } from "../types";

type Props = {
  albums: Album[];
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (name: string) => void;
  onCreate: () => void;
};

type GNode = {
  id: string;
  album: Album | null;
  genres: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  pinned: boolean;
};
type GLink = { a: GNode; b: GNode; kind: "artist" | "genre"; w: number };
type World = { nodes: GNode[]; links: GLink[] };

const STEP = 1000 / 60; // фиксированный шаг, чтобы на 120 Гц не летало вдвое быстрее
const REPEL = 140; // отталкивание нод друг от друга
const GRAVITY = 0.008; // тяга к центру
const DRIFT = 0.07; // сила «плавания»
const DAMPING = 0.6; // сколько скорости остаётся после шага
const GENRE_NEIGHBORS = 3; // сколько ближайших по жанрам связей у каждой ноды
const NEW_ID = "__new__";
const TAU = Math.PI * 2;

function genresOf(album: Album): string[] {
  const src = album as unknown as {
    genres?: string[] | string;
    genre?: string[] | string;
  };
  const raw = src.genres ?? src.genre ?? [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,;/]/);
  return list.map((g) => String(g).trim().toLowerCase()).filter(Boolean);
}

function buildGraph(albums: Album[], prev: Map<string, GNode>): World {
  const spawn = (id: string) => {
    const old = prev.get(id);
    const a = Math.random() * TAU;
    return {
      x: old?.x ?? Math.cos(a) * 30,
      y: old?.y ?? Math.sin(a) * 30,
      vx: old?.vx ?? 0,
      vy: old?.vy ?? 0,
    };
  };

  const nodes: GNode[] = albums.map((album) => ({
    id: String(album.id),
    album,
    genres: genresOf(album),
    ...spawn(String(album.id)),
    r: 22,
    phase: Math.random() * TAU,
    pinned: false,
  }));

  const links: GLink[] = [];
  const seen = new Set<string>();
  const key = (i: number, j: number) => (i < j ? `${i}:${j}` : `${j}:${i}`);
  const artistOf = (n: GNode) => n.album!.artist.trim().toLowerCase();

  // 1) один исполнитель — жёсткая связь
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (artistOf(nodes[i]) === artistOf(nodes[j])) {
        links.push({ a: nodes[i], b: nodes[j], kind: "artist", w: 1 });
        seen.add(key(i, j));
      }
    }
  }

  nodes.forEach((a, i) => {
    if (!a.genres.length) return;
    const scored: { j: number; s: number }[] = [];
    nodes.forEach((b, j) => {
      if (i === j || seen.has(key(i, j)) || !b.genres.length) return;
      const shared = a.genres.filter((g) => b.genres.includes(g)).length;
      if (!shared) return;
      const union = new Set([...a.genres, ...b.genres]).size;
      scored.push({ j, s: shared / union });
    });
    scored.sort((p, q) => q.s - p.s);
    for (const { j, s } of scored.slice(0, GENRE_NEIGHBORS)) {
      if (seen.has(key(i, j))) continue;
      seen.add(key(i, j));
      links.push({ a, b: nodes[j], kind: "genre", w: s });
    }
  });

  const deg = new Map<GNode, number>();
  for (const l of links) {
    deg.set(l.a, (deg.get(l.a) ?? 0) + 1);
    deg.set(l.b, (deg.get(l.b) ?? 0) + 1);
  }
  nodes.forEach((n) => (n.r = 20 + Math.min(deg.get(n) ?? 0, 8) * 1.6));

  nodes.push({
    id: NEW_ID,
    album: null,
    genres: [],
    ...spawn(NEW_ID),
    r: 26,
    phase: Math.random() * TAU,
    pinned: false,
  });

  return { nodes, links };
}

function simulate(world: World, t: number, calm: boolean) {
  const { nodes, links } = world;
  const n = nodes.length;

  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 640 * 640) continue;
      if (d2 < 1) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = dx * dx + dy * dy + 1;
      }
      const d = Math.sqrt(d2);
      const min = a.r + b.r + 24; // место под подпись
      let push = REPEL / d;
      if (d < min) push += (min - d) * 0.18;
      const ux = dx / d;
      const uy = dy / d;
      a.vx -= ux * push;
      a.vy -= uy * push;
      b.vx += ux * push;
      b.vy += uy * push;
    }
  }

  for (const l of links) {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const d = Math.hypot(dx, dy) || 1;
    const artist = l.kind === "artist";
    const rest = artist ? 110 : 190 - l.w * 40;
    const k = artist ? 0.05 : 0.012 + l.w * 0.02;
    const f = (d - rest) * k;
    const ux = dx / d;
    const uy = dy / d;
    l.a.vx += ux * f;
    l.a.vy += uy * f;
    l.b.vx -= ux * f;
    l.b.vy -= uy * f;
  }

  for (const nd of nodes) {
    if (nd.pinned) {
      nd.vx = nd.vy = 0;
      continue;
    }
    nd.vx -= nd.x * GRAVITY;
    nd.vy -= nd.y * GRAVITY;
    if (!calm) {
      nd.vx += Math.sin(t * 0.00061 + nd.phase) * DRIFT;
      nd.vy += Math.cos(t * 0.00047 + nd.phase * 1.7) * DRIFT;
    }
    const sp = Math.hypot(nd.vx, nd.vy);
    if (sp > 14) {
      nd.vx = (nd.vx / sp) * 14;
      nd.vy = (nd.vy / sp) * 14;
    }
    nd.x += nd.vx;
    nd.y += nd.vy;
    nd.vx *= DAMPING;
    nd.vy *= DAMPING;
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const short = (s: string, max: number) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

export function AlbumGraph({
  albums,
  onOpenAlbum,
  onOpenArtist,
  onCreate,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useRef<World>({ nodes: [], links: [] });
  const cam = useRef({ cx: 0, cy: 0, k: 1, auto: true });
  const selRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const api = useRef({ onOpenAlbum, onOpenArtist, onCreate });
  api.current = { onOpenAlbum, onOpenArtist, onCreate };

  const select = useCallback((id: string | null) => {
    selRef.current = id;
    setSelectedId(id);
  }, []);

  useEffect(() => {
    const prev = new Map(world.current.nodes.map((n) => [n.id, n]));
    world.current = buildGraph(albums, prev);
    if (
      selRef.current &&
      !world.current.nodes.some((n) => n.id === selRef.current)
    ) {
      select(null);
    }
  }, [albums, select]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const cs = getComputedStyle(wrap);
    const css = (name: string, fb: string) =>
      cs.getPropertyValue(name).trim() || fb;
    const col = {
      accent: css("--accent", "#e91e8c"),
      ink: css("--ink", "#f2f2f2"),
      muted: css("--muted", "#8a8a93"),
    };
    const font = cs.fontFamily || "sans-serif";

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // кэш обложек
    const imgs = new Map<string, HTMLImageElement>();
    const getImg = (url?: string) => {
      if (!url) return null;
      let im = imgs.get(url);
      if (!im) {
        im = new Image();
        im.decoding = "async";
        im.src = url;
        imgs.set(url, im);
      }
      return im.complete && im.naturalWidth ? im : null;
    };

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toWorld = (p: { x: number; y: number }) => ({
      x: (p.x - w / 2) / cam.current.k + cam.current.cx,
      y: (p.y - h / 2) / cam.current.k + cam.current.cy,
    });
    const pick = (p: { x: number; y: number }) => {
      const m = toWorld(p);
      const { nodes } = world.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (Math.hypot(n.x - m.x, n.y - m.y) < n.r + 4 / cam.current.k) {
          return n;
        }
      }
      return null;
    };

    let hover: GNode | null = null;
    let drag: {
      node: GNode | null;
      sx: number;
      sy: number;
      lx: number;
      ly: number;
      moved: boolean;
    } | null = null;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      const node = pick(p);
      drag = { node, sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false };
      if (node) node.pinned = true;
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (drag) {
        if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) {
          drag.moved = true;
        }
        if (drag.moved) {
          if (drag.node) {
            const m = toWorld(p);
            drag.node.x = m.x;
            drag.node.y = m.y;
          } else {
            cam.current.cx -= (p.x - drag.lx) / cam.current.k;
            cam.current.cy -= (p.y - drag.ly) / cam.current.k;
            cam.current.auto = false;
          }
        }
        drag.lx = p.x;
        drag.ly = p.y;
      } else {
        hover = pick(p);
        canvas.style.cursor = hover ? "pointer" : "grab";
      }
    };
    const onUp = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.node) {
        d.node.pinned = false;
        if (!d.moved) {
          if (d.node.album) select(d.node.id);
          else api.current.onCreate();
        }
      } else if (!d.moved) {
        select(null);
      }
    };
    const onLeave = () => {
      if (!drag) hover = null;
    };
    const onDouble = (e: MouseEvent) => {
      const n = pick(local(e));
      if (n?.album) api.current.onOpenAlbum(n.album);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current;
      const p = local(e);
      const before = toWorld(p);
      c.k = clamp(c.k * Math.exp(-e.deltaY * 0.0015), 0.2, 3);
      c.cx = before.x - (p.x - w / 2) / c.k;
      c.cy = before.y - (p.y - h / 2) / c.k;
      c.auto = false;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDouble);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const fitCamera = () => {
      const c = cam.current;
      const { nodes } = world.current;
      if (!c.auto || !nodes.length || !w) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x - n.r);
        y0 = Math.min(y0, n.y - n.r);
        x1 = Math.max(x1, n.x + n.r);
        y1 = Math.max(y1, n.y + n.r);
      }
      const bw = x1 - x0 + 140;
      const bh = y1 - y0 + 140;
      const tk = clamp(Math.min(w / bw, h / bh), 0.2, 1.2);
      c.k += (tk - c.k) * 0.05;
      c.cx += ((x0 + x1) / 2 - c.cx) * 0.05;
      c.cy += ((y0 + y1) / 2 - c.cy) * 0.05;
    };

    const draw = () => {
      const { nodes, links } = world.current;
      const { cx, cy, k } = cam.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 - cx * k, h / 2 - cy * k);
      ctx.scale(k, k);

      const selected = selRef.current
        ? (nodes.find((n) => n.id === selRef.current) ?? null)
        : null;
      const focus = drag?.node ?? hover ?? selected;
      const near = new Set<GNode>();
      if (focus) {
        for (const l of links) {
          if (l.a === focus) near.add(l.b);
          else if (l.b === focus) near.add(l.a);
        }
      }

      // линии
      for (const l of links) {
        const hot = !!focus && (l.a === focus || l.b === focus);
        const artist = l.kind === "artist";
        ctx.globalAlpha = focus ? (hot ? 1 : 0.06) : artist ? 0.75 : 0.3;
        ctx.strokeStyle = artist ? col.accent : col.muted;
        ctx.lineWidth = (artist ? 2 : 0.8 + l.w * 1.2) / k;
        ctx.beginPath();
        ctx.moveTo(l.a.x, l.a.y);
        ctx.lineTo(l.b.x, l.b.y);
        ctx.stroke();
      }

      for (const n of nodes) {
        const isF = n === focus;
        const dim = !!focus && !isF && !near.has(n);
        ctx.globalAlpha = dim ? 0.22 : 1;
        ctx.save();
        ctx.translate(n.x, n.y);

        if (!n.album) {
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.5 / k;
          ctx.strokeStyle = ctx.fillStyle = isF ? col.accent : col.muted;
          ctx.beginPath();
          ctx.arc(0, 0, n.r, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `300 30px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("+", 0, 1);
          ctx.restore();
          continue;
        }

        ctx.shadowColor = "rgba(0,0,0,.6)";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.roundRect(-n.r, -n.r, n.r * 2, n.r * 2, 4);
        ctx.save();
        ctx.clip();
        const img = getImg(n.album.coverUrl);
        if (img) {
          const s = Math.min(img.naturalWidth, img.naturalHeight);
          ctx.drawImage(
            img,
            (img.naturalWidth - s) / 2,
            (img.naturalHeight - s) / 2,
            s,
            s,
            -n.r,
            -n.r,
            n.r * 2,
            n.r * 2,
          );
        } else {
          ctx.fillStyle = col.accent;
          ctx.fillRect(-n.r, -n.r, n.r * 2, n.r * 2);
        }
        ctx.restore();
        ctx.shadowBlur = 0;

        ctx.lineWidth = 1 / k;
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        ctx.beginPath();
        ctx.roundRect(-n.r, -n.r, n.r * 2, n.r * 2, 4);
        ctx.stroke();

        if (isF) {
          ctx.lineWidth = 2 / k;
          ctx.strokeStyle = col.accent;
          ctx.beginPath();
          ctx.roundRect(-n.r - 4, -n.r - 4, (n.r + 4) * 2, (n.r + 4) * 2, 6);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = col.ink;
      for (const n of nodes) {
        if (!n.album) continue;
        const isF = n === focus;
        const rel = isF || near.has(n);
        if (!rel && k < 0.55) continue;
        ctx.globalAlpha = focus && !rel ? 0.18 : isF ? 1 : 0.8;
        const fs = (isF ? 14 : 12) / k;
        ctx.font = `${isF ? 600 : 400} ${fs}px ${font}`;
        ctx.fillStyle = col.ink;
        ctx.fillText(
          short(n.album.name, isF ? 32 : 20),
          n.x,
          n.y + n.r + 8 / k,
        );
        if (isF) {
          ctx.font = `400 ${12 / k}px ${font}`;
          ctx.fillStyle = col.muted;
          ctx.fillText(n.album.artist, n.x, n.y + n.r + 8 / k + fs + 2 / k);
        }
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(t - last, 64);
      last = t;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 3) {
        simulate(world.current, t, calm);
        acc -= STEP;
        steps++;
      }
      if (acc > STEP) acc = 0;
      fitCamera();
      draw();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [select]);

  const zoomBy = (f: number) => {
    cam.current.k = clamp(cam.current.k * f, 0.2, 3);
    cam.current.auto = false;
  };
  const fit = () => {
    cam.current.auto = true;
  };

  const selected = selectedId
    ? (albums.find((a) => String(a.id) === selectedId) ?? null)
    : null;
  const selectedGenres = selected
    ? (world.current.nodes.find((n) => n.id === selectedId)?.genres ?? [])
    : [];

  return (
    <div className="graph" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Карта альбомов: связи по исполнителям и жанрам"
      />

      <div className="graph-zoom">
        <button onClick={() => zoomBy(1.25)} aria-label="Приблизить">
          +
        </button>
        <button onClick={() => zoomBy(0.8)} aria-label="Отдалить">
          −
        </button>
        <button onClick={fit}>Вписать</button>
      </div>

      <p className="graph-legend">
        <i className="legend-line legend-artist" /> один исполнитель
        <i className="legend-line legend-genre" /> общий жанр
      </p>

      {selected && (
        <aside className="graph-card">
          <img src={selected.coverUrl} alt="" />
          <div className="graph-card-text">
            <strong>{selected.name}</strong>
            <span>{selected.artist}</span>
            {selectedGenres.length > 0 && (
              <small>{selectedGenres.join(", ")}</small>
            )}
          </div>
          <div className="graph-card-actions">
            <button className="primary" onClick={() => onOpenAlbum(selected)}>
              Открыть альбом
            </button>
            <button onClick={() => onOpenArtist(selected.artist)}>
              Все релизы исполнителя
            </button>
          </div>
          <button
            className="graph-card-close"
            onClick={() => select(null)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </aside>
      )}

      <ul className="graph-sr">
        {albums.map((a) => (
          <li key={a.id}>
            <button onClick={() => onOpenAlbum(a)}>
              {a.name} — {a.artist}
            </button>
          </li>
        ))}
        <li>
          <button onClick={onCreate}>Пустая ячейка</button>
        </li>
      </ul>
    </div>
  );
}
