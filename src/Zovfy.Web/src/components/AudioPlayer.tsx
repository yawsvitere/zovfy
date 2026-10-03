import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type TouchEvent,
} from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { getTrackLyrics, recordListening, updateLike } from "../api";
import type { Track } from "../types";
import "../styles/player.css";

type PlayRequest = { track: Track; queue: Track[]; requestId: number };
type PlaybackSession = {
  trackId: string;
  id: string;
  elapsed: number;
  lastTime: number | null;
  counted: boolean;
  sending: boolean;
};

type Props = {
  onTrackChange: (track: Track | null) => void;
  onPlayingChange: (playing: boolean) => void;
  onDurationChange: (trackId: string, duration: number) => void;
  onOpenAlbum: (track: Track) => void;
  onOpenArtist: (name: string) => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

type LyricLine = { time: number | null; text: string };

function parseLrcTimestamp(timestamp: string) {
  const match = timestamp.match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;
  const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
  return Number(match[1]) * 60 + Number(match[2]) + fraction;
}

function parseTtmlTimestamp(timestamp: string) {
  const value = timestamp.trim();
  const clock = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (clock) {
    return (
      Number(clock[1] ?? 0) * 3600 +
      Number(clock[2]) * 60 +
      Number(clock[3]) +
      (clock[4] ? Number(`0.${clock[4]}`) : 0)
    );
  }
  const offset = value.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/);
  if (!offset) return null;
  const amount = Number(offset[1]);
  return offset[2] === "h"
    ? amount * 3600
    : offset[2] === "m"
      ? amount * 60
      : offset[2] === "ms"
        ? amount / 1000
        : amount;
}

function parseLyrics(lrc: string | null, ttml: string | null): LyricLine[] {
  if (lrc?.trim()) {
    const lines: LyricLine[] = [];
    for (const line of lrc.split(/\r?\n/)) {
      const timestamps = [
        ...line.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g),
      ]
        .map((match) => parseLrcTimestamp(match[1]))
        .filter((time): time is number => time !== null);
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      if (text) {
        if (timestamps.length) {
          for (const time of timestamps) lines.push({ time, text });
        } else if (!line.trim().startsWith("[")) {
          lines.push({ time: null, text });
        }
      }
    }
    return lines.sort((left, right) =>
      left.time === null
        ? right.time === null
          ? 0
          : 1
        : right.time === null
          ? -1
          : left.time - right.time,
    );
  }

  if (!ttml?.trim()) return [];
  const document = new DOMParser().parseFromString(ttml, "application/xml");
  if (document.querySelector("parsererror")) return [];

  return Array.from(document.getElementsByTagName("*"))
    .filter((element) => element.localName.toLowerCase() === "p")
    .map((element) => ({
      time: parseTtmlTimestamp(element.getAttribute("begin") ?? ""),
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((line) => line.text)
    .sort((left, right) =>
      left.time === null
        ? right.time === null
          ? 0
          : 1
        : right.time === null
          ? -1
          : left.time - right.time,
    );
}

type LyricItem =
  | { kind: "line"; line: LyricLine; lineIndex: number }
  | { kind: "gap"; start: number; end: number };

type LyricView = {
  key: string;
  items: LyricItem[];
  synced: boolean;
  clock: number;
};

function buildLyricItems(lines: LyricLine[]): LyricItem[] {
  const items: LyricItem[] = [];
  const first = lines[0];
  if (first && first.time !== null && first.time >= 3) {
    items.push({ kind: "gap", start: 0, end: first.time });
  }
  lines.forEach((line, lineIndex) => {
    items.push({ kind: "line", line, lineIndex });
    const next = lines[lineIndex + 1];
    if (line.time !== null && next && next.time !== null) {
      const sung = Math.min(8, Math.max(3, line.text.length * 0.1));
      const start = line.time + sung;
      if (next.time - start >= 5) {
        items.push({ kind: "gap", start, end: next.time });
      }
    }
  });
  return items;
}

function findActiveItem(items: LyricItem[], time: number) {
  let active = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "gap") {
      if (time >= item.start && time < item.end) return index;
    } else if (item.line.time !== null && item.line.time <= time) {
      active = index;
    }
  }
  return active;
}

function readLikedIds() {
  try {
    return new Set<string>(
      JSON.parse(localStorage.getItem("zovfy.likedTracks") ?? "[]"),
    );
  } catch {
    return new Set<string>();
  }
}

function sameTrack(left: Track | null, right: Track) {
  return Boolean(
    left &&
    (left.id && right.id ? left.id === right.id : left.url === right.url),
  );
}

export function AudioPlayer({
  onTrackChange,
  onPlayingChange,
  onDurationChange,
  onOpenAlbum,
  onOpenArtist,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const currentTrackRef = useRef<Track | null>(null);
  const playbackSessionRef = useRef<PlaybackSession | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousVolume = useRef(0.75);
  const coverTimer = useRef<number | undefined>(undefined);
  const transitionGainRef = useRef(1);
  const fadeFrameRef = useRef<number | null>(null);
  const cancelFadeRef = useRef<(() => void) | null>(null);
  const trackTransitionRef = useRef(0);
  const pendingTrackTransitionRef = useRef(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const volumeRef = useRef(volume);
  const [repeatMode, setRepeatMode] = useState(0);
  const [shuffled, setShuffled] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [coverActive, setCoverActive] = useState(false);
  const [liked, setLiked] = useState(false);
  const [error, setError] = useState("");
  const [lyricsState, setLyricsState] = useState<{
    key: string | null;
    lrc: string | null;
    ttml: string | null;
    loading: boolean;
    error: string;
  }>({ key: null, lrc: null, ttml: null, loading: false, error: "" });
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const focusElRef = useRef<HTMLElement | null>(null);
  const lastViewRef = useRef<LyricView | null>(null);
  const [openId, setOpenId] = useState(0);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const setFocusEl = useCallback((element: HTMLElement | null) => {
    focusElRef.current = element;
  }, []);

  const lyricsKey = track ? (track.id ?? track.url ?? track.title) : null;

  useEffect(() => {
    if (!track || !lyricsKey) {
      setLyricsState({
        key: null,
        lrc: null,
        ttml: null,
        loading: false,
        error: "",
      });
      return;
    }

    if (track.lyricsLrc?.trim() || track.lyricsTtml?.trim()) {
      setLyricsState({
        key: lyricsKey,
        lrc: track.lyricsLrc ?? null,
        ttml: track.lyricsTtml ?? null,
        loading: false,
        error: "",
      });
      return;
    }

    if (!track.id) {
      setLyricsState({
        key: lyricsKey,
        lrc: null,
        ttml: null,
        loading: false,
        error: "",
      });
      return;
    }

    const controller = new AbortController();
    setLyricsState({
      key: lyricsKey,
      lrc: null,
      ttml: null,
      loading: true,
      error: "",
    });
    void getTrackLyrics(track.id, controller.signal)
      .then(({ lrc, ttml }) => {
        setLyricsState({
          key: lyricsKey,
          lrc,
          ttml,
          loading: false,
          error: "",
        });
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setLyricsState({
          key: lyricsKey,
          lrc: null,
          ttml: null,
          loading: false,
          error:
            fetchError instanceof Error
              ? fetchError.message
              : "Не удалось загрузить текст песни.",
        });
      });
    return () => controller.abort();
  }, [lyricsKey, track?.lyricsLrc, track?.lyricsTtml]);

  const inlineLyrics = Boolean(
    track?.lyricsLrc?.trim() || track?.lyricsTtml?.trim(),
  );
  const currentLyrics = inlineLyrics
    ? {
        key: lyricsKey,
        lrc: track?.lyricsLrc ?? null,
        ttml: track?.lyricsTtml ?? null,
        loading: false,
        error: "",
      }
    : lyricsState.key === lyricsKey
      ? lyricsState
      : null;
  const lyricLines = useMemo(
    () => parseLyrics(currentLyrics?.lrc ?? null, currentLyrics?.ttml ?? null),
    [currentLyrics?.lrc, currentLyrics?.ttml],
  );
  const lyricItems = useMemo(() => buildLyricItems(lyricLines), [lyricLines]);
  const hasLyricsContent = Boolean(
    currentLyrics?.lrc?.trim() || currentLyrics?.ttml?.trim(),
  );
  const lyricsSynced = lyricLines.some((line) => line.time !== null);

  const lyricsStatus: "pending" | "ready" | "error" | "none" = !track
    ? "none"
    : currentLyrics === null
      ? track.id
        ? "pending"
        : "none"
      : currentLyrics.loading
        ? "pending"
        : currentLyrics.error
          ? "error"
          : lyricLines.length
            ? "ready"
            : hasLyricsContent
              ? "error"
              : "none";
  const lyricsErrorText =
    currentLyrics?.error || "Не удалось прочитать текст песни.";

  const wantsLyricsOpen = lyricsStatus === "ready" || lyricsStatus === "error";
  if (lyricsStatus !== "pending" && wantsLyricsOpen !== lyricsOpen) {
    setLyricsOpen(wantsLyricsOpen);
  }

  if (lyricsStatus === "ready") {
    lastViewRef.current = {
      key: lyricsKey ?? "",
      items: lyricItems,
      synced: lyricsSynced,
      clock: currentTime,
    };
  }
  const lyricsView =
    lyricsStatus === "ready" || lyricsStatus === "none"
      ? lastViewRef.current
      : null;
  const activeItemIndex = lyricsView
    ? findActiveItem(lyricsView.items, lyricsView.clock)
    : -1;
  const listKey = `${lyricsView?.key ?? lyricsStatus}:${openId}`;

  function centerLyrics(behavior: ScrollBehavior) {
    const list = lyricsListRef.current;
    if (!list) return;
    const target = focusElRef.current;
    if (!target || !list.contains(target)) {
      list.scrollTo({ top: 0, behavior });
      return;
    }
    const listRect = list.getBoundingClientRect();
    const mainRect = mainRef.current?.getBoundingClientRect();
    const mainCenter = mainRect
      ? mainRect.top + mainRect.height / 2 - listRect.top
      : -1;
    const targetY =
      mainCenter > 0 && mainCenter < list.clientHeight
        ? mainCenter
        : list.clientHeight * 0.4;
    list.scrollTo({
      top: target.offsetTop + target.offsetHeight / 2 - targetY,
      behavior,
    });
  }

  useLayoutEffect(() => {
    if (fullscreen) setOpenId((value) => value + 1);
  }, [fullscreen]);
  useLayoutEffect(() => {
    centerLyrics("auto");
  }, [listKey]);

  useEffect(() => {
    centerLyrics("smooth");
  }, [activeItemIndex]);

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const main = mainRef.current;
    if (!layout || !main) return;
    function measure() {
      const style = getComputedStyle(layout!);
      const left = parseFloat(style.paddingLeft) || 0;
      const right = parseFloat(style.paddingRight) || 0;
      const top = parseFloat(style.paddingTop) || 0;
      const bottom = parseFloat(style.paddingBottom) || 0;
      const x =
        left +
        (layout!.clientWidth - left - right) / 2 -
        (main!.offsetLeft + main!.offsetWidth / 2);
      const y =
        top +
        (layout!.clientHeight - top - bottom) / 2 -
        (main!.offsetTop + main!.offsetHeight / 2);
      layout!.style.setProperty("--fs-shift-x", `${x.toFixed(1)}px`);
      layout!.style.setProperty("--fs-shift-y", `${y.toFixed(1)}px`);
      centerLyrics("auto");
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    return () => observer.disconnect();
  }, [Boolean(track)]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let frame = 0;
    let samples: Uint8Array<ArrayBuffer> | null = null;
    let smoothedLevel = 0;

    function stopAnalysis() {
      cancelAnimationFrame(frame);
      smoothedLevel = 0;
      window.dispatchEvent(new CustomEvent("zovfy:audio-level", { detail: 0 }));
    }

    function analyze() {
      const analyzer = analyzerRef.current;
      const context = audioContextRef.current;
      if (!analyzer || !context || audio!.paused) {
        stopAnalysis();
        return;
      }

      if (!samples || samples.length !== analyzer.frequencyBinCount) {
        samples = new Uint8Array(analyzer.frequencyBinCount);
      }
      analyzer.getByteFrequencyData(samples);

      const binWidth = context.sampleRate / analyzer.fftSize;
      const firstBin = Math.ceil(165 / binWidth);
      const lastBin = Math.floor(235 / binWidth);
      let sum = 0;
      for (let bin = firstBin; bin <= lastBin; bin += 1) {
        sum += samples[bin];
      }
      const average = sum / Math.max(1, lastBin - firstBin + 1);
      const targetLevel = Math.max(0, Math.min(1, (average - 165) / 130));
      const smoothing = targetLevel > smoothedLevel ? 0.12 : 0.06;
      smoothedLevel += (targetLevel - smoothedLevel) * smoothing;
      window.dispatchEvent(
        new CustomEvent("zovfy:audio-level", { detail: smoothedLevel }),
      );
      frame = requestAnimationFrame(analyze);
    }

    function startAnalysis() {
      try {
        if (!audioContextRef.current) {
          const context = new AudioContext();
          const analyzer = context.createAnalyser();
          analyzer.fftSize = 2048;
          analyzer.smoothingTimeConstant = 0.72;
          const source = context.createMediaElementSource(audio!);
          source.connect(analyzer);
          analyzer.connect(context.destination);
          audioContextRef.current = context;
          analyzerRef.current = analyzer;
          sourceRef.current = source;
        }
        void audioContextRef.current.resume().then(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(analyze);
        });
      } catch {
        stopAnalysis();
      }
    }

    audio.addEventListener("play", startAnalysis);
    audio.addEventListener("pause", stopAnalysis);
    audio.addEventListener("ended", stopAnalysis);
    if (!audio.paused) startAnalysis();

    return () => {
      audio.removeEventListener("play", startAnalysis);
      audio.removeEventListener("pause", stopAnalysis);
      audio.removeEventListener("ended", stopAnalysis);
      stopAnalysis();
      sourceRef.current?.disconnect();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      analyzerRef.current = null;
      sourceRef.current = null;
    };
  }, [Boolean(track)]);

  useEffect(() => {
    function receivePlayRequest(event: Event) {
      const { track: nextTrack, queue: nextQueue } = (
        event as CustomEvent<PlayRequest>
      ).detail;
      const audio = audioRef.current;
      setQueue(nextQueue);
      if (sameTrack(currentTrackRef.current, nextTrack) && audio) {
        if (audio.paused) void audio.play();
        else audio.pause();
        return;
      }

      startTrack(nextTrack);
    }
    window.addEventListener("zovfy:play-track", receivePlayRequest);
    return () =>
      window.removeEventListener("zovfy:play-track", receivePlayRequest);
  }, []);

  useEffect(() => {
    onTrackChange(track);
    playbackSessionRef.current = track?.id
      ? {
          trackId: track.id,
          id: crypto.randomUUID(),
          elapsed: 0,
          lastTime: null,
          counted: false,
          sending: false,
        }
      : null;
    if (!track) return;
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setLiked(Boolean(track.id && readLikedIds().has(track.id)));
    const audio = audioRef.current;
    if (!audio || !track.url) return;
    audio.src = track.url;
    audio.load();
    void audio.play();
  }, [track?.id, track?.url]);

  useEffect(() => {
    function syncLikedState() {
      setLiked(Boolean(track?.id && readLikedIds().has(track.id)));
    }
    window.addEventListener("zovfy:likes-changed", syncLikedState);
    return () =>
      window.removeEventListener("zovfy:likes-changed", syncLikedState);
  }, [track?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    volumeRef.current = volume;
    if (audio) audio.volume = volume * transitionGainRef.current;
  }, [volume]);

  useEffect(() => {
    document.body.style.overflow = fullscreen || queueOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [fullscreen, queueOpen]);

  useEffect(() => {
    if (!fullscreen && !queueOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFullscreen(false);
        setQueueOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, queueOpen]);

  useEffect(
    () => () => {
      window.clearTimeout(coverTimer.current);
      cancelFadeRef.current?.();
    },
    [],
  );

  function fadeAudioTo(target: number, duration: number) {
    cancelFadeRef.current?.();
    const audio = audioRef.current;
    if (!audio) return Promise.resolve(false);

    if (duration <= 0) {
      transitionGainRef.current = target;
      audio.volume = volumeRef.current * target;
      return Promise.resolve(true);
    }

    const initialGain = transitionGainRef.current;
    const startedAt = performance.now();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let cancel: () => void;
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        if (fadeFrameRef.current !== null) {
          cancelAnimationFrame(fadeFrameRef.current);
          fadeFrameRef.current = null;
        }
        if (cancelFadeRef.current === cancel) cancelFadeRef.current = null;
        resolve(completed);
      };
      cancel = () => finish(false);
      cancelFadeRef.current = cancel;

      const step = (now: number) => {
        if (settled) return;
        const progress = Math.min((now - startedAt) / duration, 1);
        const easedProgress = progress * (2 - progress);
        const gain = initialGain + (target - initialGain) * easedProgress;
        transitionGainRef.current = gain;
        if (audioRef.current === audio) {
          audio.volume = volumeRef.current * gain;
        }
        if (progress >= 1) {
          finish(true);
          return;
        }
        fadeFrameRef.current = requestAnimationFrame(step);
      };
      fadeFrameRef.current = requestAnimationFrame(step);
    });
  }

  function startTrack(nextTrack: Track, fadeOut = true) {
    const transitionId = ++trackTransitionRef.current;
    const audio = audioRef.current;
    const beginTrack = () => {
      if (transitionId !== trackTransitionRef.current) return;
      pendingTrackTransitionRef.current = false;
      currentTrackRef.current = nextTrack;
      setTrack(nextTrack);
      setError("");
    };

    if (audio && nextTrack.url && !audio.paused && fadeOut) {
      pendingTrackTransitionRef.current = true;
      void fadeAudioTo(0, 120).then((completed) => {
        if (completed) beginTrack();
      });
      return;
    }

    pendingTrackTransitionRef.current = false;
    if (audio && nextTrack.url) void fadeAudioTo(0, 0);
    beginTrack();
  }

  function stepTrack(direction: -1 | 1, fadeOut = true) {
    if (!queue.length) return;
    const index = Math.max(
      0,
      queue.findIndex((item) => sameTrack(track, item)),
    );
    if (shuffled && direction > 0 && queue.length > 1) {
      const candidates = queue.filter(
        (_, candidateIndex) => candidateIndex !== index,
      );
      startTrack(
        candidates[Math.floor(Math.random() * candidates.length)],
        fadeOut,
      );
      return;
    }
    const nextIndex = index + direction;
    if (nextIndex < 0) startTrack(queue.at(-1)!, fadeOut);
    else if (nextIndex >= queue.length) {
      if (repeatMode === 1) startTrack(queue[0], fadeOut);
      else {
        setIsPlaying(false);
        onPlayingChange(false);
      }
    } else startTrack(queue[nextIndex], fadeOut);
  }

  function previousTrack() {
    if (currentTime > 1 && audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    stepTrack(-1);
  }

  function handleEnded() {
    if (repeatMode === 2 && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play();
      return;
    }
    stepTrack(1, false);
  }

  function toggleLike() {
    if (!track?.id) return;
    const ids = readLikedIds();
    if (ids.has(track.id)) ids.delete(track.id);
    else ids.add(track.id);
    localStorage.setItem("zovfy.likedTracks", JSON.stringify([...ids]));
    setLiked(ids.has(track.id));
    void updateLike("tracks", track.id, ids.has(track.id)).catch(() =>
      setError("Не удалось сохранить трек в аккаунте."),
    );
    window.dispatchEvent(new Event("zovfy:likes-changed"));
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration)) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest(
        ".zovfy-fullscreen-lyrics-lines, input",
      )
    ) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaY > 110 && Math.abs(deltaY) > Math.abs(deltaX))
      setFullscreen(false);
    else if (Math.abs(deltaX) > 90 && Math.abs(deltaX) > Math.abs(deltaY))
      stepTrack(deltaX < 0 ? 1 : -1);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (audio?.paused) void audio.play();
    else audio?.pause();
  }

  function showCoverControls() {
    setCoverActive(true);
    window.clearTimeout(coverTimer.current);
    coverTimer.current = window.setTimeout(() => setCoverActive(false), 3500);
  }

  function onCoverPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") return;
    if ((event.target as HTMLElement).closest("button, input")) {
      if (coverActive) showCoverControls();
      return;
    }
    if (coverActive) {
      window.clearTimeout(coverTimer.current);
      setCoverActive(false);
    } else {
      showCoverControls();
    }
  }

  if (!track) return null;

  const coverStyle = track.coverUrl
    ? { backgroundImage: `url("${track.coverUrl.replaceAll('"', '\\"')}")` }
    : undefined;
  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <aside className="zovfy-player" aria-label="Аудиоплеер">
        <div className="zovfy-player-track">
          {track.coverUrl ? (
            <img src={track.coverUrl} alt="" className="zovfy-player-cover" />
          ) : (
            <div className="zovfy-player-cover zovfy-player-cover-empty" />
          )}
          <div className="zovfy-player-copy">
            <strong
              title={track.title}
              onClick={() => {
                if (track.albumId) onOpenAlbum(track);
              }}
              style={{ cursor: track.albumId ? "pointer" : "default" }}
            >
              {track.title}
            </strong>
            {track.artist ? (
              <button
                className="zovfy-artist-link"
                title={track.artist}
                onClick={() => onOpenArtist(track.artist!)}
              >
                {track.artist}
              </button>
            ) : (
              <span>Неизвестный исполнитель</span>
            )}
          </div>
          <button
            className={`zovfy-icon-button zovfy-like${liked ? " active" : ""}`}
            onClick={toggleLike}
            title={liked ? "Убрать из избранного" : "Добавить в избранное"}
            aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
          >
            <Heart size={18} fill={liked ? "currentColor" : "none"} />
          </button>
        </div>

        <div className="zovfy-player-center">
          <div className="zovfy-player-controls">
            <button
              className={`zovfy-icon-button subtle${shuffled ? " active" : ""}`}
              onClick={() => setShuffled((value) => !value)}
              title="Перемешать"
              aria-label="Перемешать"
            >
              <Shuffle size={17} />
            </button>
            <button
              className="zovfy-icon-button subtle"
              onClick={previousTrack}
              title="Предыдущий трек"
              aria-label="Предыдущий трек"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              className="zovfy-play-button"
              onClick={() => {
                const audio = audioRef.current;
                if (audio?.paused) void audio.play();
                else audio?.pause();
              }}
              title={isPlaying ? "Пауза" : "Воспроизвести"}
              aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
            >
              {isPlaying ? (
                <Pause size={19} fill="currentColor" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <button
              className="zovfy-icon-button subtle"
              onClick={() => stepTrack(1)}
              title="Следующий трек"
              aria-label="Следующий трек"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              className={`zovfy-icon-button subtle${repeatMode ? " active" : ""}`}
              onClick={() => setRepeatMode((mode) => (mode + 1) % 3)}
              title={
                repeatMode === 2
                  ? "Повтор трека"
                  : repeatMode === 1
                    ? "Повтор очереди"
                    : "Повтор выключен"
              }
              aria-label="Режим повтора"
            >
              {repeatMode === 2 ? <Repeat2 size={17} /> : <Repeat size={17} />}
              {repeatMode === 2 && <span className="zovfy-repeat-one">1</span>}
            </button>
          </div>
          <div className="zovfy-timeline">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Позиция воспроизведения"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              style={
                { "--player-progress": `${progress}%` } as React.CSSProperties
              }
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="zovfy-player-extra">
          <button
            className="zovfy-icon-button subtle"
            onClick={() => setQueueOpen(true)}
            title="Очередь воспроизведения"
            aria-label="Очередь воспроизведения"
          >
            <ListMusic size={19} />
          </button>
          <button
            className="zovfy-icon-button subtle zovfy-volume-button"
            onClick={() =>
              setVolume((value) => (value ? 0 : previousVolume.current))
            }
            title={volume ? "Выключить звук" : "Включить звук"}
            aria-label={volume ? "Выключить звук" : "Включить звук"}
          >
            {volume ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <input
            className="zovfy-volume"
            aria-label="Громкость"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            style={
              { "--player-progress": `${volume * 100}%` } as React.CSSProperties
            }
            onChange={(event) => {
              const next = Number(event.target.value);
              if (next) previousVolume.current = next;
              setVolume(next);
            }}
          />
          <button
            className="zovfy-icon-button subtle"
            onClick={() => setFullscreen(true)}
            title="Развернуть плеер"
            aria-label="Развернуть плеер"
          >
            <Maximize2 size={18} />
          </button>
        </div>
        {error && (
          <div className="zovfy-player-error" role="status">
            {error}
            <button onClick={() => setError("")} aria-label="Скрыть">
              <X size={13} />
            </button>
          </div>
        )}
      </aside>

      <div
        className={`zovfy-fullscreen${fullscreen ? " active" : ""}${isPlaying ? " is-playing" : ""}`}
        aria-hidden={!fullscreen}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="zovfy-fullscreen-backdrop" style={coverStyle} />
        <button
          className="zovfy-fullscreen-close"
          onClick={() => setFullscreen(false)}
          title="Свернуть"
          aria-label="Свернуть"
        >
          <ChevronDown size={24} />
        </button>

        <div
          className={`zovfy-fullscreen-layout${lyricsOpen ? "" : " no-lyrics"}`}
          ref={layoutRef}
        >
          <div className="zovfy-fullscreen-main" ref={mainRef}>
            <div
              className={`zovfy-fs-cover${isPlaying ? "" : " paused"}${coverActive ? " show-controls" : ""}`}
              onPointerUp={onCoverPointerUp}
            >
              {track.coverUrl ? (
                <img
                  className="zovfy-fullscreen-cover"
                  src={track.coverUrl}
                  alt={`Обложка альбома: ${track.title}`}
                  draggable={false}
                />
              ) : (
                <div className="zovfy-fullscreen-cover zovfy-player-cover-empty" />
              )}
              <div className="zovfy-fs-shade" />
              <div className="zovfy-fs-controls">
                <div className="zovfy-fs-row">
                  <button
                    className={`zovfy-fs-btn${shuffled ? " active" : ""}`}
                    onClick={() => setShuffled((value) => !value)}
                    title="Перемешать"
                    aria-label="Перемешать"
                  >
                    <Shuffle size={19} />
                  </button>
                  <button
                    className="zovfy-fs-btn"
                    onClick={previousTrack}
                    title="Предыдущий трек"
                    aria-label="Предыдущий трек"
                  >
                    <SkipBack size={22} fill="currentColor" />
                  </button>
                  <button
                    className="zovfy-fs-btn play"
                    onClick={togglePlay}
                    title={isPlaying ? "Пауза" : "Воспроизвести"}
                    aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
                  >
                    {isPlaying ? (
                      <Pause size={28} fill="currentColor" />
                    ) : (
                      <Play size={28} fill="currentColor" />
                    )}
                  </button>
                  <button
                    className="zovfy-fs-btn"
                    onClick={() => stepTrack(1)}
                    title="Следующий трек"
                    aria-label="Следующий трек"
                  >
                    <SkipForward size={22} fill="currentColor" />
                  </button>
                  <button
                    className={`zovfy-fs-btn${repeatMode ? " active" : ""}`}
                    onClick={() => setRepeatMode((mode) => (mode + 1) % 3)}
                    title={
                      repeatMode === 2
                        ? "Повтор трека"
                        : repeatMode === 1
                          ? "Повтор очереди"
                          : "Повтор выключен"
                    }
                    aria-label="Режим повтора"
                  >
                    {repeatMode === 2 ? (
                      <Repeat2 size={19} />
                    ) : (
                      <Repeat size={19} />
                    )}
                  </button>
                </div>
                <div className="zovfy-fs-bottom">
                  <button
                    className={`zovfy-fs-btn${liked ? " active" : ""}`}
                    onClick={toggleLike}
                    title={
                      liked ? "Убрать из избранного" : "Добавить в избранное"
                    }
                    aria-label={
                      liked ? "Убрать из избранного" : "Добавить в избранное"
                    }
                  >
                    <Heart size={21} fill={liked ? "currentColor" : "none"} />
                  </button>
                  <div className="zovfy-fs-volume">
                    <button
                      className="zovfy-fs-btn"
                      onClick={() =>
                        setVolume((value) =>
                          value ? 0 : previousVolume.current,
                        )
                      }
                      title={volume ? "Выключить звук" : "Включить звук"}
                      aria-label={volume ? "Выключить звук" : "Включить звук"}
                    >
                      {volume ? <Volume2 size={20} /> : <VolumeX size={20} />}
                    </button>
                    <input
                      className="zovfy-fs-range"
                      aria-label="Громкость"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      style={
                        {
                          "--player-progress": `${volume * 100}%`,
                        } as React.CSSProperties
                      }
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (next) previousVolume.current = next;
                        setVolume(next);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="zovfy-fs-info">
              <h2
                className={track.albumId ? "linked" : undefined}
                title={track.title}
                onClick={() => {
                  if (track.albumId) onOpenAlbum(track);
                }}
              >
                {track.title}
              </h2>
              {track.artist ? (
                <button
                  className="zovfy-artist-link"
                  onClick={() => onOpenArtist(track.artist!)}
                >
                  {track.artist}
                </button>
              ) : (
                <p>Неизвестный исполнитель</p>
              )}
            </div>

            <div className="zovfy-fs-progress">
              <input
                className="zovfy-fs-range"
                aria-label="Позиция воспроизведения"
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(currentTime, duration || 0)}
                style={
                  { "--player-progress": `${progress}%` } as React.CSSProperties
                }
                onChange={(event) => seek(Number(event.target.value))}
              />
              <div className="zovfy-fs-times" aria-hidden="true">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>

          <section
            className={`zovfy-fullscreen-lyrics${lyricsOpen ? "" : " collapsed"}`}
            aria-hidden={!lyricsOpen}
            aria-label={`Текст песни: ${track.title}`}
          >
            <div
              key={listKey}
              ref={lyricsListRef}
              className={`zovfy-fullscreen-lyrics-lines${
                lyricsView ? (lyricsView.synced ? "" : " plain") : " status"
              }`}
            >
              {lyricsView ? (
                lyricsView.items.map((item, index) => {
                  const focusIndex = activeItemIndex >= 0 ? activeItemIndex : 0;
                  const distance = lyricsView.synced
                    ? Math.abs(index - focusIndex) +
                      (activeItemIndex >= 0 ? 0 : 1)
                    : index;
                  const active = index === activeItemIndex;
                  const focus = lyricsView.synced && index === focusIndex;
                  const style = { "--d": distance } as React.CSSProperties;

                  if (item.kind === "gap") {
                    const progress = Math.min(
                      1,
                      Math.max(
                        0,
                        (lyricsView.clock - item.start) /
                          (item.end - item.start),
                      ),
                    );
                    return (
                      <div
                        className={`zovfy-fullscreen-lyric zovfy-lyric-gap${active ? " active" : ""}`}
                        key={`gap-${item.start.toFixed(1)}`}
                        ref={focus ? setFocusEl : undefined}
                        style={
                          {
                            ...style,
                            "--p": progress.toFixed(3),
                          } as React.CSSProperties
                        }
                        aria-hidden="true"
                      >
                        <span className="zovfy-lyric-dots">
                          {[0, 1, 2].map((dot) => (
                            <i
                              key={dot}
                              style={{ "--i": dot } as React.CSSProperties}
                            />
                          ))}
                        </span>
                      </div>
                    );
                  }

                  const { line, lineIndex } = item;
                  return (
                    <p
                      className={`zovfy-fullscreen-lyric${active ? " active" : ""}${line.time !== null ? " seekable" : ""}`}
                      key={`${line.time ?? "static"}-${lineIndex}`}
                      ref={focus ? setFocusEl : undefined}
                      style={style}
                      onClick={() => {
                        if (line.time !== null) seek(line.time);
                      }}
                    >
                      {line.text}
                    </p>
                  );
                })
              ) : lyricsStatus === "error" ? (
                <p className="zovfy-fullscreen-lyric-message" role="status">
                  {lyricsErrorText}
                </p>
              ) : lyricsStatus === "pending" && lyricsOpen ? (
                <div className="zovfy-lyrics-skeleton" aria-hidden="true">
                  {[72, 52, 84, 60, 76].map((width, index) => (
                    <span
                      key={index}
                      style={{
                        width: `${width}%`,
                        animationDelay: `${index * 140}ms`,
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      {queueOpen && (
        <div
          className="zovfy-queue-overlay"
          role="presentation"
          onClick={() => setQueueOpen(false)}
        >
          <section
            className="zovfy-queue-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Очередь воспроизведения"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>ПЛЕЙЛИСТ</span>
                <h2>Очередь воспроизведения</h2>
              </div>
              <button
                className="zovfy-icon-button"
                onClick={() => setQueueOpen(false)}
                title="Закрыть"
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </header>
            <div className="zovfy-queue-list">
              {queue.map((item, index) => (
                <button
                  className={`zovfy-queue-item${sameTrack(track, item) ? " current" : ""}`}
                  key={item.id ?? `${item.url}-${index}`}
                  onClick={() => {
                    startTrack(item);
                    setQueueOpen(false);
                  }}
                >
                  {item.coverUrl ? (
                    <img src={item.coverUrl} alt="" />
                  ) : (
                    <span className="zovfy-queue-cover" />
                  )}
                  <span className="zovfy-queue-copy">
                    <strong>{item.title}</strong>
                    <small>{item.artist || "Неизвестный исполнитель"}</small>
                  </span>
                  {sameTrack(track, item) && isPlaying ? (
                    <span
                      className="zovfy-playing-bars"
                      aria-label="Воспроизводится"
                    />
                  ) : (
                    <span className="zovfy-queue-index">{index + 1}</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <audio
        ref={audioRef}
        preload="metadata"
        onSeeking={(event) => {
          const session = playbackSessionRef.current;
          if (session) session.lastTime = event.currentTarget.currentTime;
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          setCurrentTime(time);
          const session = playbackSessionRef.current;
          if (!track?.id || session?.trackId !== track.id) return;
          const previousTime = session.lastTime;
          session.lastTime = time;
          if (previousTime !== null) {
            const elapsed = time - previousTime;
            if (elapsed > 0 && elapsed <= 10) session.elapsed += elapsed;
          }

          const threshold = duration > 0 && duration < 30 ? duration * 0.9 : 30;
          if (
            session.elapsed >= threshold &&
            !session.counted &&
            !session.sending
          ) {
            session.sending = true;
            void recordListening(track.id, session.id)
              .then(() => {
                session.counted = true;
              })
              .catch(() => {})
              .finally(() => {
                session.sending = false;
              });
          }
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration)) {
            setDuration(nextDuration);
            if (track?.id) onDurationChange(track.id, nextDuration);
          }
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlayingChange(true);
          void fadeAudioTo(1, 220);
        }}
        onPause={() => {
          if (pendingTrackTransitionRef.current) {
            pendingTrackTransitionRef.current = false;
            trackTransitionRef.current += 1;
            cancelFadeRef.current?.();
            void fadeAudioTo(1, 100);
          }
          setIsPlaying(false);
          onPlayingChange(false);
        }}
        onEnded={handleEnded}
        onError={() => setError("Не удалось загрузить аудиопоток.")}
      />
    </>
  );
}
