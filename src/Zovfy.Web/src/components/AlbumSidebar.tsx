import { Disc3, Home, ListMusic, Plus } from 'lucide-react'
import type { Screen } from '../types'

type Props = { screen: Screen; onNavigate: (screen: Screen) => void }

export function AlbumSidebar({ screen, onNavigate }: Props) {
  return <aside className="music-sidebar">
    <button className="music-brand" onClick={() => onNavigate('home')}><Disc3 size={22} />zovfy</button>
    <nav className="music-nav" aria-label="Навигация">
      <button className={screen === 'home' ? 'active' : ''} onClick={() => onNavigate('home')}><Home size={18} />Главная</button>
      <button className={screen === 'albums' || screen === 'detail' ? 'active' : ''} onClick={() => onNavigate('albums')}><ListMusic size={18} />Альбомы</button>
      <button className={screen === 'create' ? 'active' : ''} onClick={() => onNavigate('create')}><Plus size={18} />Создать альбом</button>
    </nav>
    <div className="music-sidebar-foot">Музыкальный каталог</div>
  </aside>
}