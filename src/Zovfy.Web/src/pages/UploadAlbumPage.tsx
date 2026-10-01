import { useState, type FormEvent } from 'react'
import { LoaderCircle, Plus, Upload, X } from 'lucide-react'
import '../styles/upload.css'
import type { PendingTrack } from '../types'

const audioExtensions = /\.(mp3|wav|flac|ogg)$/i
type Props = { authenticated: boolean; onSubmit: (formData: FormData) => Promise<void>; onRequireAuth: () => void; onCancel: () => void }

export function UploadAlbumPage({ authenticated, onSubmit, onRequireAuth, onCancel }: Props) {
  const [albumName, setAlbumName] = useState('')
  const [artist, setArtist] = useState('')
  const [year, setYear] = useState('')
  const [cover, setCover] = useState<File | null>(null)
  const [tracks, setTracks] = useState<PendingTrack[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function addTracks(fileList: FileList | null) {
    if (!fileList) return
    const added: PendingTrack[] = []
    const rejected: string[] = []
    Array.from(fileList).forEach((file) => {
      if (!audioExtensions.test(file.name)) rejected.push(file.name)
      else added.push({ id: crypto.randomUUID(), file, title: file.name.replace(/\.[^.]+$/, '') })
    })
    setTracks((current) => [...current, ...added])
    setError(rejected.length ? `Не поддерживается формат: ${rejected.join(', ')}` : '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tracks.length) { setError('Добавьте хотя бы один аудиотрек.'); return }
    setError('')
    setSubmitting(true)
    const formData = new FormData()
    formData.append('name', albumName.trim())
    formData.append('artist', artist.trim())
    if (year) formData.append('year', year)
    if (cover) formData.append('cover', cover)
    formData.append('trackTitles', JSON.stringify(tracks.map((track) => track.title.trim() || track.file.name)))
    formData.append('trackOrders', JSON.stringify(tracks.map((_, index) => index + 1)))
    formData.append('trackMainArtists', JSON.stringify(tracks.map(() => artist.trim())))
    tracks.forEach((track) => formData.append('tracks', track.file))
    try { await onSubmit(formData) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось отправить альбом.') }
    finally { setSubmitting(false) }
  }

  return <form className="album-form" onSubmit={handleSubmit}>
    {error && <div className="message message-error" role="alert">{error}</div>}
    <div className="form-intro"><h2>Информация об альбоме</h2><p>Заполните данные и добавьте аудиофайлы.</p></div>
    <div className="form-fields">
      <label>Название альбома<input required maxLength={120} value={albumName} onChange={(event) => setAlbumName(event.target.value)} placeholder="Название" /></label>
      <div className="form-row"><label>Исполнитель<input required maxLength={120} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Имя артиста" /></label><label>Год выпуска<input type="number" min="1900" max="2100" value={year} onChange={(event) => setYear(event.target.value)} placeholder="2026" /></label></div>
      <label className="file-picker">Обложка альбома <span>{cover?.name ?? 'Выбрать изображение'}</span><input type="file" accept="image/*" onChange={(event) => setCover(event.target.files?.[0] ?? null)} /></label>
    </div>
    <div className="track-section">
      <div className="track-section-heading"><div><h2>Треки</h2><p>MP3, WAV, FLAC или OGG</p></div><label className="secondary-button"><Plus size={16} />Добавить треки<input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg" multiple onChange={(event) => { addTracks(event.target.files); event.target.value = '' }} /></label></div>
      {tracks.length ? <ol className="pending-tracks">{tracks.map((track, index) => <li key={track.id}><span className="track-number">{String(index + 1).padStart(2, '0')}</span><input aria-label={`Название трека ${index + 1}`} value={track.title} onChange={(event) => setTracks((current) => current.map((item) => item.id === track.id ? { ...item, title: event.target.value } : item))} /><small>{track.file.name}</small><button type="button" className="remove-track" aria-label={`Удалить ${track.title}`} onClick={() => setTracks((current) => current.filter((item) => item.id !== track.id))}><X size={16} /></button></li>)}</ol> : <label className="drop-zone"><Upload size={22} /><strong>Выберите аудиофайлы</strong><span>Файлы можно загрузить сразу все</span><input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg" multiple onChange={(event) => { addTracks(event.target.files); event.target.value = '' }} /></label>}
    </div>
    <div className="form-actions">{authenticated ? <button type="button" className="secondary-button" onClick={onCancel}>К альбомам</button> : <button type="button" className="secondary-button" onClick={onRequireAuth}>Войти</button>}<button type="submit" className="primary-button" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{submitting ? 'Отправка…' : `Отправить альбом${tracks.length ? ` · ${tracks.length}` : ''}`}</button></div>
  </form>
}