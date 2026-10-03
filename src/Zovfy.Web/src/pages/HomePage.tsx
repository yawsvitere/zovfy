import "../styles/catalog.css";
import type { Album } from "../types";
import { AlbumGraph } from "./AlbumGraph";

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
      <AlbumGraph
        albums={albums}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
        onCreate={onCreate}
      />
    </div>
  );
}
