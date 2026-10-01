import { useEffect, useRef, useState, type TouchEvent } from "react";
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
import { recordListening, updateLike } from "../api";
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
  onOpenArtist: (name: string) => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
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
  const [track, setTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [repeatMode, setRepeatMode] = useState(0);
  const [shuffled, setShuffled] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [error, setError] = useState("");

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
        if (audio.paused)
          void audio
            .play()
            .catch(() => setError("Не удалось воспроизвести трек."));
        else audio.pause();
        return;
      }

      currentTrackRef.current = nextTrack;
      setTrack(nextTrack);
      setError("");
      if (!audio || !nextTrack.url) return;
      audio.src = nextTrack.url;
      audio.load();
      void audio.play().catch(() => setError("Не удалось воспроизвести трек."));
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
    void audio.play().catch(() => setError("Не удалось воспроизвести трек."));
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
    if (audio) audio.volume = volume;
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

  function startTrack(nextTrack: Track) {
    currentTrackRef.current = nextTrack;
    setTrack(nextTrack);
    setError("");
    const audio = audioRef.current;
    if (!audio || !nextTrack.url) return;
    audio.src = nextTrack.url;
    audio.load();
    void audio.play().catch(() => setError("Не удалось воспроизвести трек."));
  }

  function stepTrack(direction: -1 | 1) {
    if (!queue.length) return;
    const index = Math.max(
      0,
      queue.findIndex((item) => sameTrack(track, item)),
    );
    if (shuffled && direction > 0 && queue.length > 1) {
      const candidates = queue.filter(
        (_, candidateIndex) => candidateIndex !== index,
      );
      startTrack(candidates[Math.floor(Math.random() * candidates.length)]);
      return;
    }
    const nextIndex = index + direction;
    if (nextIndex < 0) startTrack(queue.at(-1)!);
    else if (nextIndex >= queue.length) {
      if (repeatMode === 1) startTrack(queue[0]);
      else {
        setIsPlaying(false);
        onPlayingChange(false);
      }
    } else startTrack(queue[nextIndex]);
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
    stepTrack(1);
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
            <strong title={track.title}>{track.title}</strong>
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
                if (audio?.paused)
                  void audio
                    .play()
                    .catch(() => setError("Не удалось воспроизвести трек."));
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
        className={`zovfy-fullscreen${fullscreen ? " active" : ""}`}
        aria-hidden={!fullscreen}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="zovfy-fullscreen-backdrop" style={coverStyle} />
        <header className="zovfy-fullscreen-header">
          <button
            className="zovfy-fullscreen-close"
            onClick={() => setFullscreen(false)}
            title="Свернуть"
            aria-label="Свернуть"
          >
            <ChevronDown size={25} />
          </button>
          <span>СЕЙЧАС ИГРАЕТ</span>
          <button
            className="zovfy-fullscreen-close"
            onClick={() => setQueueOpen(true)}
            title="Очередь"
            aria-label="Очередь"
          >
            <ListMusic size={21} />
          </button>
        </header>
        <div className="zovfy-fullscreen-content">
          <div className="zovfy-fullscreen-main">
            {track.coverUrl ? (
              <img
                className="zovfy-fullscreen-cover"
                src={track.coverUrl}
                alt={`Обложка альбома: ${track.title}`}
              />
            ) : (
              <div className="zovfy-fullscreen-cover zovfy-player-cover-empty" />
            )}
            <div className="zovfy-fullscreen-info">
              <div>
                <h2>{track.title}</h2>
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
              <button
                className={`zovfy-icon-button zovfy-like${liked ? " active" : ""}`}
                onClick={toggleLike}
                title={liked ? "Убрать из избранного" : "Добавить в избранное"}
                aria-label={
                  liked ? "Убрать из избранного" : "Добавить в избранное"
                }
              >
                <Heart size={21} fill={liked ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="zovfy-fullscreen-timeline">
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
              <div>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
            <div className="zovfy-fullscreen-controls">
              <button
                className={`zovfy-icon-button${shuffled ? " active" : ""}`}
                onClick={() => setShuffled((value) => !value)}
                title="Перемешать"
                aria-label="Перемешать"
              >
                <Shuffle size={20} />
              </button>
              <button
                className="zovfy-icon-button"
                onClick={previousTrack}
                title="Предыдущий трек"
                aria-label="Предыдущий трек"
              >
                <SkipBack size={24} fill="currentColor" />
              </button>
              <button
                className="zovfy-fullscreen-play"
                onClick={() => {
                  const audio = audioRef.current;
                  if (audio?.paused)
                    void audio
                      .play()
                      .catch(() => setError("Не удалось воспроизвести трек."));
                  else audio?.pause();
                }}
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
                className="zovfy-icon-button"
                onClick={() => stepTrack(1)}
                title="Следующий трек"
                aria-label="Следующий трек"
              >
                <SkipForward size={24} fill="currentColor" />
              </button>
              <button
                className={`zovfy-icon-button${repeatMode ? " active" : ""}`}
                onClick={() => setRepeatMode((mode) => (mode + 1) % 3)}
                title="Повтор"
                aria-label="Режим повтора"
              >
                {repeatMode === 2 ? (
                  <Repeat2 size={20} />
                ) : (
                  <Repeat size={20} />
                )}
              </button>
            </div>
            <div className="zovfy-fullscreen-bottom">
              <button
                className="zovfy-icon-button"
                onClick={() => setQueueOpen(true)}
                title="Очередь воспроизведения"
                aria-label="Очередь воспроизведения"
              >
                <ListMusic size={21} />
              </button>
              <div className="zovfy-fullscreen-volume">
                <VolumeX size={18} />
                <input
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
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
                <Volume2 size={18} />
              </div>
            </div>
          </div>
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
        }}
        onPause={() => {
          setIsPlaying(false);
          onPlayingChange(false);
        }}
        onEnded={handleEnded}
        onError={() => setError("Не удалось загрузить аудиопоток.")}
      />
    </>
  );
}
