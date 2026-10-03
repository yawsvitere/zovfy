import {
  Fragment,
  useEffect,
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

type LyricLine = { time: number | null; end: number | null; text: string };

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
          for (const time of timestamps) lines.push({ time, end: null, text });
        } else if (!line.trim().startsWith("[")) {
          lines.push({ time: null, end: null, text });
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
    .map((element) => {
      const time = parseTtmlTimestamp(element.getAttribute("begin") ?? "");
      const explicitEnd = parseTtmlTimestamp(element.getAttribute("end") ?? "");
      const duration = parseTtmlTimestamp(element.getAttribute("dur") ?? "");
      const end =
        explicitEnd ??
        (time !== null && duration !== null ? time + duration : null);
      return {
        time,
        end: time !== null && end !== null && end > time ? end : null,
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    })
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
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);

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

  const currentLyrics = lyricsState.key === lyricsKey ? lyricsState : null;
  const lyricLines = useMemo(
    () => parseLyrics(currentLyrics?.lrc ?? null, currentLyrics?.ttml ?? null),
    [currentLyrics?.lrc, currentLyrics?.ttml],
  );
  const activeLyricIndex = lyricLines.reduce(
    (activeIndex, line, index) =>
      line.time !== null && line.time <= currentTime ? index : activeIndex,
    -1,
  );
  const hasEmbeddedLyrics = Boolean(
    track?.lyricsLrc?.trim() || track?.lyricsTtml?.trim(),
  );
  const hasLyricsContent = Boolean(
    currentLyrics?.lrc?.trim() || currentLyrics?.ttml?.trim(),
  );
  const lyricsSynced = lyricLines.some((line) => line.time !== null);
  // Во время загрузки не двигаем обложку: сначала узнаём, есть ли вообще текст.
  // Это убирает неприятный сценарий «центр → вбок → обратно в центр».
  const showLyrics = Boolean(
    hasEmbeddedLyrics || currentLyrics?.error || hasLyricsContent,
  );
  const beforeFirstLyric =
    showLyrics && lyricsSynced && lyricLines.length > 0 && activeLyricIndex < 0;
  const activeLyric = lyricLines[activeLyricIndex];
  const nextLyric = lyricLines[activeLyricIndex + 1];
  const lyricGapAfterIndex =
    activeLyric?.end !== null &&
    activeLyric?.end !== undefined &&
    nextLyric?.time !== null &&
    nextLyric?.time !== undefined &&
    activeLyric.end < nextLyric.time &&
    currentTime >= activeLyric.end &&
    currentTime < nextLyric.time
      ? activeLyricIndex
      : -1;

  useEffect(() => {
    const list = lyricsListRef.current;
    if (!list) return;
    const activeLine = activeLyricRef.current;
    if (!activeLine) {
      list.scrollTo({ top: 0 });
      return;
    }
    const listRect = list.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();
    // Desktop: текущая строка по центру блока «обложка + управление».
    // Mobile (блок выше текста): ~40% высоты списка.
    const main = mainRef.current?.getBoundingClientRect();
    const mainCenter = main ? main.top + main.height / 2 - listRect.top : -1;
    const targetY =
      mainCenter > 0 && mainCenter < list.clientHeight
        ? mainCenter
        : list.clientHeight * 0.4;
    list.scrollTo({
      top:
        list.scrollTop +
        (lineRect.top - listRect.top) +
        lineRect.height / 2 -
        targetY,
      behavior: "smooth",
    });
  }, [activeLyricIndex, fullscreen, lyricGapAfterIndex, lyricLines.length]);

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
    if (audio && nextTrack.url) {
      void fadeAudioTo(0, 0);
    }
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

  // На тач-устройствах нет hover: тап по обложке показывает/прячет управление.
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

        <div className="zovfy-fullscreen-layout">
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
            className={`zovfy-fullscreen-lyrics${showLyrics ? " visible" : " collapsed"}`}
            aria-hidden={!showLyrics}
            aria-label={`Текст песни: ${track.title}`}
          >
            <div
              className={`zovfy-fullscreen-lyrics-lines${lyricsSynced ? "" : " plain"}${beforeFirstLyric ? " before-first" : ""}`}
              ref={lyricsListRef}
            >
              {currentLyrics?.error ? (
                <p className="zovfy-fullscreen-lyric-message" role="status">
                  {currentLyrics.error}
                </p>
              ) : lyricLines.length ? (
                <>
                  {beforeFirstLyric && (
                    <div
                      className="zovfy-lyrics-dots lyric-gap active"
                      aria-hidden="true"
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                  {lyricLines.map((line, index) => (
                    <Fragment key={`${line.time ?? "static"}-${index}`}>
                      <p
                        className={`zovfy-fullscreen-lyric${index === activeLyricIndex && index !== lyricGapAfterIndex ? " active" : ""}${index === 0 && activeLyricIndex === 0 && index !== lyricGapAfterIndex ? " first-active" : ""}${line.time !== null ? " seekable" : ""}`}
                        ref={
                          index === activeLyricIndex &&
                          index !== lyricGapAfterIndex
                            ? activeLyricRef
                            : null
                        }
                        style={
                          {
                            "--d":
                              activeLyricIndex < 0
                                ? index + 1
                                : Math.abs(index - activeLyricIndex),
                            "--i": index,
                          } as React.CSSProperties
                        }
                        onClick={() => {
                          if (line.time !== null) seek(line.time);
                        }}
                      >
                        {line.text}
                      </p>
                      {lyricsSynced && index === lyricGapAfterIndex && (
                        <div
                          className="zovfy-lyrics-dots lyric-gap active"
                          ref={activeLyricRef}
                          aria-hidden="true"
                        >
                          <span />
                          <span />
                          <span />
                        </div>
                      )}
                    </Fragment>
                  ))}
                </>
              ) : (
                <p className="zovfy-fullscreen-lyric-message">
                  {hasLyricsContent
                    ? "Не удалось прочитать текст песни."
                    : "Для этого трека пока нет текста."}
                </p>
              )}
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
