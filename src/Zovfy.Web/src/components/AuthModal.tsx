import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import '../styles/auth.css'

type Props = { open: boolean; onClose: () => void; onSubmit: (email: string, password: string, mode: 'login' | 'register') => Promise<void> }

export function AuthModal({ open, onClose, onSubmit }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  if (!open) return null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try { await onSubmit(email, password, mode); setPassword('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось выполнить вход.') }
    finally { setSubmitting(false) }
  }

  return <div className="auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="auth-dialog" onSubmit={handleSubmit}>
      <button type="button" className="auth-close" aria-label="Закрыть" onClick={onClose}><X size={18} /></button>
      <h2>{mode === 'login' ? 'Вход' : 'Регистрация'}</h2>
      {error && <div className="message message-error" role="alert">{error}</div>}
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Пароль<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
      <button type="button" className="auth-switch" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}</button>
    </form>
  </div>
}