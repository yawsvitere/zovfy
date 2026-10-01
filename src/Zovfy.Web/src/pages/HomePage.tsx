import "../styles/catalog.css";
import type { Album } from "../types";

type Props = {
  albums: Album[];
  loading: boolean;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (name: string) => void;
  onCreate: () => void;
};

export function HomePage({
  albums,
  loading,
  onOpenAlbum,
  onOpenArtist,
  onCreate,
}: Props) {
  if (loading) return <p className="list-empty">Ищем пластинки…</p>;

  return (
    <div className="home">
      <ol className="rows">
        {albums.map((album, i) => (
          <li key={album.id} className="row">
            <span className="row-index">{String(i + 1).padStart(2, "0")}</span>

            <button className="row-main" onClick={() => onOpenAlbum(album)}>
              <span className="disc">
                <span className="vinyl">
                  <span className="vinyl-spin">
                    <img className="vinyl-label" src={album.coverUrl} alt="" />
                    <i className="vinyl-hole" />
                  </span>
                  <span className="vinyl-shine" />
                </span>
                <img className="sleeve" src={album.coverUrl} alt={album.name} />
              </span>
              <span className="row-title">{album.name}</span>
            </button>

            <button
              className="row-artist"
              onClick={() => onOpenArtist(album.artist)}
            >
              {album.artist} →
            </button>
          </li>
        ))}

        <li className="row row-new">
          <span className="row-index">
            {String(albums.length + 1).padStart(2, "0")}
          </span>
          <button className="row-main" onClick={onCreate}>
            <span className="disc disc-empty">+</span>
            <span className="row-title">Пустая ячейка</span>
          </button>
        </li>
      </ol>
    </div>
  );
}
