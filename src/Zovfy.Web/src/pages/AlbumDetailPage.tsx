import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Disc3,
  Download,
  Heart,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Plus,
  Shuffle,
  X,
} from "lucide-react";
import type { Album, Track } from "../types";
import "../styles/album-cards.css";
import "../styles/album-detail.css";

type Props = {
  album: Album | null;
  albums: Album[];
  loading: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  durations: Record<string, number>;
  onPlayTracks: (tracks: Track[], index: number, coverUrl?: string) => void;
  onBack: () => void;
  onOpenAlbum: (album: Album) => void;
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

export function AlbumDetailPage({
  album,
  albums,
  loading,
  currentTrackId,
  isPlaying,
  durations,
  onPlayTracks,
  onBack,
  onOpenAlbum,
}: Props) {
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);
  const [visibleMenuId, setVisibleMenuId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const recommendationsRef = useRef<HTMLDivElement | null>(null);
  const [likedAlbums, setLikedAlbums] = useState(() =>
    readSavedIds("zovfy.likedAlbums"),
  );
  const [likedTracks, setLikedTracks] = useState(() =>
    readSavedIds("zovfy.likedTracks"),
  );

  useEffect(() => {
    if (!modalOpen && !visibleMenuId) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setModalOpen(false);
        setVisibleMenuId(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, visibleMenuId]);

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

  function scrollRecommendations(direction: 1 | -1) {
    const node = recommendationsRef.current;
    if (!node) return;
    const amount = Math.max(node.clientWidth * 0.8, 260);
    node.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  const tracks = album?.tracks ?? [];
  const recommended = albums.filter((item) => item?.id !== album?.id);
  const sameArtist = recommended.filter(
    (item) => item.artist === album?.artist,
  );
  const visibleRecommendations = (
    sameArtist.length ? sameArtist : recommended
  ).slice(0, 8);
  const totalDuration = tracks.reduce(
    (total, track, index) =>
      total + (track.duration ?? durations[trackKey(track, index)] ?? 0),
    0,
  );
  const albumLiked = album ? likedAlbums.has(album.id) : false;

  useEffect(() => {
    const element = recommendationsRef.current;
    if (!element) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const updateState = () => {
      const maxScrollLeft = element.scrollWidth - element.clientWidth;
      setCanScrollLeft(element.scrollLeft > 8);
      setCanScrollRight(element.scrollLeft < maxScrollLeft - 8);
    };

    updateState();
    element.addEventListener("scroll", updateState, { passive: true });
    window.addEventListener("resize", updateState);

    return () => {
      element.removeEventListener("scroll", updateState);
      window.removeEventListener("resize", updateState);
    };
  }, [visibleRecommendations.length]);

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
    setLikedAlbums(
      saveLikes("zovfy.likedAlbums", (current) => {
        if (current.has(albumId)) current.delete(albumId);
        else current.add(albumId);
        return current;
      }),
    );
  }

  function toggleTrackLike(id: string) {
    const next = saveLikes("zovfy.likedTracks", (current) => {
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return current;
    });
    setLikedTracks(next);
    window.dispatchEvent(new Event("zovfy:likes-changed"));
    setVisibleMenuId(null);
  }

  function playTrack(track: Track, index: number) {
    if (!track.url) {
      setNotice("Для этого трека пока нет аудиофайла.");
      return;
    }
    onPlayTracks(tracks, index, album?.coverUrl);
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

  const coverImage = album.coverUrl
    ? `url("${album.coverUrl.replaceAll('"', '\\"')}")`
    : undefined;

  return (
    <div
      className="album-page"
      style={{ "--album-cover-image": coverImage } as React.CSSProperties}
    >
      <section className="album-content">
        <header className="album-hero">
          <button
            className="album-cover-button"
            onClick={() => album.coverUrl && setModalOpen(true)}
            aria-label="Открыть обложку"
          >
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
          </button>
          <div className="album-info">
            <span className="album-type">Альбом</span>
            <h2 className="album-title">{album.name}</h2>
            <p className="album-details">
              <span className="artist-link">{album.artist}</span>
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
                  <div className="track-playcount">0</div>
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

      {modalOpen && album.coverUrl && (
        <div
          className="media-modal active"
          role="dialog"
          aria-modal="true"
          aria-label={`Обложка альбома ${album.name}`}
          onClick={() => setModalOpen(false)}
        >
          <div
            className="modal-content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setModalOpen(false)}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>
            <img
              className="modal-media"
              src={album.coverUrl}
              alt={`Обложка: ${album.name}`}
            />
          </div>
        </div>
      )}

      {visibleRecommendations.length > 0 && (
        <section className="recommended-section">
          <h3 className="rec-title">
            {sameArtist.length
              ? `Больше от ${album.artist}`
              : "Рекомендуем также"}
          </h3>
          <div className="carousel-container">
            {canScrollLeft && (
              <button
                className="carousel-arrow carousel-arrow-left"
                onClick={() => scrollRecommendations(-1)}
                aria-label="Назад"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="carousel-track" ref={recommendationsRef}>
              {visibleRecommendations.map((item) => (
                <article className="album-card" key={item.id}>
                  <button
                    className="recommended-open"
                    onClick={() => onOpenAlbum(item)}
                    aria-label={`Открыть альбом ${item.name}`}
                  >
                    {item.coverUrl ? (
                      <img
                        className="album-cover"
                        src={item.coverUrl}
                        alt={item.name}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    ) : (
                      <span className="album-cover album-cover-fallback">
                        <Disc3 size={38} />
                      </span>
                    )}
                    <span className="album-info">
                      <span className="album-title">{item.name}</span>
                      <span className="album-artist">{item.artist}</span>
                    </span>
                  </button>
                  <button
                    className="play-button"
                    onClick={() => onOpenAlbum(item)}
                    aria-label={`Открыть ${item.name}`}
                  >
                    <Play size={17} fill="currentColor" />
                  </button>
                </article>
              ))}
            </div>
            {canScrollRight && (
              <button
                className="carousel-arrow carousel-arrow-right"
                onClick={() => scrollRecommendations(1)}
                aria-label="Вперед"
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
