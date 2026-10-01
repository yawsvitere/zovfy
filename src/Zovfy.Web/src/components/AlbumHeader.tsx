import { ArrowLeft, Plus } from 'lucide-react'
import type { Screen } from '../types'

type Props = { title: string; screen: Screen; authenticated: boolean; onNavigate: (screen: Screen) => void; onLogin: () => void; onLogout: () => void }

export function AlbumHeader({ title, screen, authenticated, onNavigate, onLogin, onLogout }: Props) {
  return <header className="music-header">
    <div className="music-heading">{screen === 'detail' && <button className="back-button" onClick={() => onNavigate('albums')} aria-label="К альбомам"><ArrowLeft size={18} /></button>}<h1>{title}</h1></div>
    <div className="header-actions">
      <button className="secondary-button auth-trigger" onClick={authenticated ? onLogout : onLogin}>{authenticated ? 'Выйти' : 'Войти'}</button>
      {screen !== 'create' && <button className="primary-button" onClick={() => onNavigate('create')}><Plus size={17} />Новый альбом</button>}
    </div>
  </header>
}