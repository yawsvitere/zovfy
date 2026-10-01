import { AlbumGrid } from '../components/AlbumGrid'
import '../styles/catalog.css'
import type { Album } from '../types'

type Props = { albums: Album[]; loading: boolean; onOpenAlbum: (album: Album) => void; onCreate: () => void }

export function HomePage({ albums, loading, onOpenAlbum, onCreate }: Props) {
  return <><div className="catalog-tools"><p>Все альбомы каталога</p></div><AlbumGrid albums={albums} loading={loading} onOpenAlbum={onOpenAlbum} onCreate={onCreate} /></>
}