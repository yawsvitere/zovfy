import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  Clock3,
  Download,
  Heart,
  MoreVertical,
  Music2,
  Pencil,
  Pause,
  Play,
  Plus,
  Shuffle,
  X,
} from "lucide-react";
import { getArtist, updateLike } from "../api";
import { AlbumEditModal } from "../components/AlbumEditModal";
import type { Album, Track } from "../types";
import "../styles/album-cards.css";
import "../styles/album-detail.css";
import "../styles/album-motion.css";

type Props = {
  album: Album | null;
  albums: Album[];
  loading: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  durations: Record<string, number>;
  onPlayTracks: (
    tracks: Track[],
    index: number,
    coverUrl?: string,
    albumId?: string,
  ) => void;
  onBack: () => void;
  onOpenArtist: (name: string) => void;
  onUpdateAlbum: (id: string, formData: FormData) => Promise<void>;
};

function readSavedIds(key: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function trackKey(track: Track, index: number) {
  return track.id ?? `${track.title}-${index}`;
}

function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatTotalDuration(seconds: number) {
  if (!seconds) return "0 мин";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function trackWord(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "треков";
  if (last === 1) return "трек";
  if (last >= 2 && last <= 4) return "трека";
  return "треков";
}

function useFitViewport(
  ref: { current: HTMLElement | null },
  watchKey: string | null,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !watchKey) return;
    let scroller: HTMLElement = document.documentElement;
    for (
      let p = el.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      const overflowY = getComputedStyle(p).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        scroller = p;
        break;
      }
    }
    const prevOverflow = scroller.style.overflowY;
    scroller.scrollTop = 0;
    scroller.style.overflowY = "hidden";

    const measure = () => {
      el.style.setProperty(
        "--page-top",
        `${Math.max(0, el.getBoundingClientRect().top)}px`,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      scroller.style.overflowY = prevOverflow;
    };
  }, [ref, watchKey]);
}

export function AlbumDetailPage({
  album,
  loading,
  currentTrackId,
  isPlaying,
  durations,
  onPlayTracks,
  onBack,
  onOpenArtist,
  onUpdateAlbum,
}: Props) {
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);
  const [visibleMenuId, setVisibleMenuId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [likedAlbums, setLikedAlbums] = useState(() =>
    readSavedIds("zovfy.likedAlbums"),
  );
  const [likedTracks, setLikedTracks] = useState(() =>
    readSavedIds("zovfy.likedTracks"),
  );
  const [artistAvatarUrl, setArtistAvatarUrl] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  useFitViewport(pageRef, album && !loading ? album.id : null);

  useEffect(() => {
    let active = true;
    setArtistAvatarUrl(null);
    if (!album?.artist) return;
    void getArtist(album.artist)
      .then((profile) => {
        if (active) setArtistAvatarUrl(profile.avatarUrl ?? null);
      })
      .catch(() => {
        if (active) setArtistAvatarUrl(null);
      });
    return () => {
      active = false;
    };
  }, [album?.artist]);

  useEffect(() => {
    if (!visibleMenuId) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setVisibleMenuId(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visibleMenuId]);

  useEffect(() => {
    function syncLikedTracks() {
      setLikedTracks(readSavedIds("zovfy.likedTracks"));
    }
    window.addEventListener("zovfy:likes-changed", syncLikedTracks);
    return () =>
      window.removeEventListener("zovfy:likes-changed", syncLikedTracks);
  }, []);

  useEffect(() => {
    if (!visibleMenuId) return;
    function onDocumentClick(event: MouseEvent) {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".track-menu-container")
      ) {
        setVisibleMenuId(null);
      }
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [visibleMenuId]);

  const tracks = album?.tracks ?? [];
  const totalDuration = tracks.reduce(
    (total, track, index) =>
      total + (track.duration ?? durations[trackKey(track, index)] ?? 0),
    0,
  );
  const albumLiked = album ? likedAlbums.has(album.id) : false;

  if (loading) return <div className="loading-state">Загружаю альбом…</div>;
  if (!album)
    return (
      <div className="empty-state">
        <h2>Альбом не найден</h2>
        <button className="secondary-button" onClick={onBack}>
          <ArrowLeft size={16} />К альбомам
        </button>
      </div>
    );

  function saveLikes(
    key: string,
    update: (current: Set<string>) => Set<string>,
  ) {
    const next = update(readSavedIds(key));
    localStorage.setItem(key, JSON.stringify([...next]));
    return next;
  }

  function toggleAlbumLike(albumId: string) {
    const next = saveLikes("zovfy.likedAlbums", (current) => {
      if (current.has(albumId)) current.delete(albumId);
      else current.add(albumId);
      return current;
    });
    setLikedAlbums(next);
    void updateLike("albums", albumId, next.has(albumId)).catch(() =>
      setNotice("Не удалось сохранить альбом в аккаунте."),
    );
  }

  function toggleTrackLike(id: string) {
    const next = saveLikes("zovfy.likedTracks", (current) => {
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return current;
    });
    setLikedTracks(next);
    void updateLike("tracks", id, next.has(id)).catch(() =>
      setNotice("Не удалось сохранить трек в аккаунте."),
    );
    window.dispatchEvent(new Event("zovfy:likes-changed"));
    setVisibleMenuId(null);
  }

  function playTrack(track: Track, index: number) {
    if (!track.url) {
      setNotice("Для этого трека пока нет аудиофайла.");
      return;
    }
    onPlayTracks(tracks, index, album?.coverUrl, album?.id);
    setNotice("");
  }

  function handleTrackKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    track: Track,
    index: number,
  ) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      playTrack(track, index);
    }
  }

  return (
    <div
      key={album.id}
      ref={pageRef}
      className={`album-page${tracks.length > 0 && tracks.length <= 2 ? " album-page--single" : ""}`}
    >
      <section className="album-content">
        <header className="album-hero">
          <div className="album-cover-button">
            {album.coverUrl ? (
              <img
                className="album-cover"
                src={album.coverUrl}
                alt={album.name}
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            ) : (
              <span className="album-cover album-cover-fallback">
                <Music2 size={54} />
              </span>
            )}
          </div>
          <div className="album-info">
            <span className="album-type">Альбом</span>
            <h2 className="album-title">{album.name}</h2>
            <p className="album-details">
              <span className="artist-identity">
                {artistAvatarUrl && (
                  <img
                    className="artist-avatar-small"
                    src={artistAvatarUrl}
                    alt=""
                    onError={() => setArtistAvatarUrl(null)}
                  />
                )}
                <button
                  className="artist-link"
                  type="button"
                  onClick={() => onOpenArtist(album.artist)}
                >
                  {album.artist}
                </button>
              </span>
              {album.year ? <> · {album.year}</> : null}
              {album.genre ? <> · {album.genre}</> : null}
              {" · "}
              {tracks.length} {trackWord(tracks.length)}
              {" · "}
              {formatTotalDuration(totalDuration)}
            </p>
          </div>
        </header>

        {notice && (
          <p className="album-feedback" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Скрыть сообщение">
              <X size={15} />
            </button>
          </p>
        )}

        <div className="album-actions album-track-controls">
          <button
            className="play-all-btn compact-icon-btn"
            onClick={() => tracks[0] && playTrack(tracks[0], 0)}
            disabled={!tracks.length}
            aria-label={
              isPlaying && tracks[0]?.id === currentTrackId
                ? "Пауза"
                : "Воспроизвести"
            }
          >
            {isPlaying && tracks[0]?.id === currentTrackId ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
            <span className="btn-label">
              {isPlaying && tracks[0]?.id === currentTrackId
                ? "Пауза"
                : "Слушать"}
            </span>
          </button>
          <button
            className="album-icon-btn shuffle-album-btn"
            type="button"
            aria-label="Перемешать"
          >
            <Shuffle size={16} />
          </button>
          <button
            className={`album-icon-btn like-album-btn${albumLiked ? " liked" : ""}`}
            onClick={() => toggleAlbumLike(album.id)}
            aria-label={
              albumLiked ? "Убрать лайк с альбома" : "Лайкнуть альбом"
            }
            aria-pressed={albumLiked}
            type="button"
          >
            <Heart size={18} fill={albumLiked ? "currentColor" : "none"} />
          </button>
          <button
            className="album-icon-btn download-album-btn"
            type="button"
            aria-label="Скачать альбом"
          >
            <Download size={16} />
          </button>
          {album.canEdit && (
            <button
              className="album-icon-btn edit-album-btn"
              type="button"
              aria-label="Редактировать альбом"
              title="Редактировать альбом"
              onClick={() => setEditOpen(true)}
            >
              <Pencil size={17} />
            </button>
          )}
        </div>

        <section className="track-list" aria-label="Треки альбома">
          <div className="track-header">
            <span>#</span>
            <span>Название</span>
            <span>Прослушивания</span>
            <span>
              <Clock3 size={15} />
            </span>
          </div>
          {tracks.length ? (
            tracks.map((track, index) => {
              const id = trackKey(track, index);
              const trackIsPlaying = currentTrackId === id && isPlaying;
              const isHovered = hoveredTrackId === id;
              const liked = likedTracks.has(id);
              return (
                <div
                  className={`track-row${trackIsPlaying ? " playing" : ""}${isHovered ? " hovered" : ""}`}
                  key={id}
                  style={{ "--i": index } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  onClick={() => playTrack(track, index)}
                  onKeyDown={(event) => handleTrackKeyDown(event, track, index)}
                  onMouseEnter={() => setHoveredTrackId(id)}
                  onMouseLeave={() => setHoveredTrackId(null)}
                >
                  <div className="track-index">
                    {isHovered ? (
                      <button
                        className="index-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          playTrack(track, index);
                        }}
                        aria-label={trackIsPlaying ? "Пауза" : "Воспроизвести"}
                      >
                        {trackIsPlaying ? (
                          <Pause size={15} fill="currentColor" />
                        ) : (
                          <Play size={15} fill="currentColor" />
                        )}
                      </button>
                    ) : trackIsPlaying ? (
                      <span className="playing-bars" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>
                  <div className="track-info">
                    <span className="track-title">{track.title}</span>
                    <span className="track-artist">
                      {track.artist || album.artist}
                    </span>
                  </div>
                  <div className="track-playcount">
                    {(track.playCount ?? 0).toLocaleString("ru-RU")}
                  </div>
                  <div
                    className="track-right"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="track-duration">
                      {formatDuration(track.duration ?? durations[id])}
                    </span>
                    <div className="track-menu-container">
                      <button
                        className="track-menu-btn"
                        onClick={() =>
                          setVisibleMenuId(visibleMenuId === id ? null : id)
                        }
                        aria-label="Действия с треком"
                        aria-expanded={visibleMenuId === id}
                      >
                        <MoreVertical size={18} />
                      </button>
                      {visibleMenuId === id && (
                        <div className="track-menu">
                          <button
                            className={`menu-item${liked ? " liked" : ""}`}
                            onClick={() => toggleTrackLike(id)}
                          >
                            <Heart
                              size={15}
                              fill={liked ? "currentColor" : "none"}
                            />
                            {liked ? "Убрать лайк" : "Лайк"}
                          </button>
                          <button
                            className="menu-item"
                            onClick={() => {
                              setVisibleMenuId(null);
                              setNotice(
                                "Добавление в плейлист появится вместе с поддержкой плейлистов.",
                              );
                            }}
                          >
                            <Plus size={15} />
                            Добавить в плейлист
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="no-tracks">
              В этом альбоме пока нет доступных треков.
            </p>
          )}
        </section>
      </section>

      {editOpen && (
        <AlbumEditModal
          album={album}
          onClose={() => setEditOpen(false)}
          onSave={(formData) => onUpdateAlbum(album.id, formData)}
        />
      )}
    </div>
  );
}
