import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AlbumGrid } from "../components/AlbumGrid";
import "../styles/catalog.css";
import type { Album } from "../types";

type Props = {
  albums: Album[];
  loading: boolean;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (name: string) => void;
  onCreate: () => void;
};

export function AlbumsPage({
  albums,
  loading,
  onOpenAlbum,
  onOpenArtist,
  onCreate,
}: Props) {
  const [search, setSearch] = useState("");
  const filteredAlbums = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? albums.filter((album) =>
          `${album.name} ${album.artist}`.toLocaleLowerCase().includes(query),
        )
      : albums;
  }, [albums, search]);
  return (
    <>
      <div className="catalog-tools">
        <p>
          {albums.length} {albums.length === 1 ? "альбом" : "альбомов"}
        </p>
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти альбом или артиста"
          />
        </label>
      </div>
      <AlbumGrid
        albums={filteredAlbums}
        loading={loading}
        query={search.trim()}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
        onCreate={onCreate}
      />
    </>
  );
}
