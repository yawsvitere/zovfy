import { Disc3, Music2 } from "lucide-react";
import "../styles/album-cards.css";
import type { Album } from "../types";

type Props = {
  albums: Album[];
  loading: boolean;
  query?: string;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (name: string) => void;
  onCreate: () => void;
};

export function AlbumGrid({
  albums,
  loading,
  query = "",
  onOpenAlbum,
  onOpenArtist,
  onCreate,
}: Props) {
  if (loading) return <div className="loading-state">Загружаю альбомы…</div>;
  if (!albums.length)
    return (
      <div className="empty-state">
        <Disc3 size={28} />
        <h2>{query ? "Ничего не найдено" : "Альбомов пока нет"}</h2>
        <p>
          {query
            ? "Попробуйте изменить поисковый запрос."
            : "Создайте первый альбом и добавьте в него треки."}
        </p>
        {!query && (
          <button className="primary-button" onClick={onCreate}>
            Создать альбом
          </button>
        )}
      </div>
    );
  return (
    <div className="album-grid">
      {albums.map((album) => (
        <article className="album-card" key={album.id}>
          <button
            type="button"
            className="album-card-open"
            onClick={() => onOpenAlbum(album)}
            aria-label={`Открыть альбом ${album.name}`}
          >
            <span className="album-cover">
              {album.coverUrl ? (
                <img src={album.coverUrl} alt="" />
              ) : (
                <Music2 size={31} />
              )}
            </span>
          </button>
          <span className="album-card-copy">
            <button
              type="button"
              className="album-card-title"
              onClick={() => onOpenAlbum(album)}
            >
              {album.name}
            </button>
            <button
              type="button"
              className="album-card-artist"
              onClick={() => onOpenArtist(album.artist)}
            >
              {album.artist}
            </button>
            <small>
              {album.year || "Год не указан"} ·{" "}
              {album.trackCount ?? album.tracks?.length ?? 0} треков
            </small>
          </span>
        </article>
      ))}
    </div>
  );
}
