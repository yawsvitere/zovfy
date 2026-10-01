import type { Album, AlbumDetailsResponse, AuthResponse } from './types'

type ApiError = { error?: string; message?: string; errors?: string[] }

export async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as ApiError
  if (!response.ok) throw new Error(body.message || body.error || body.errors?.join(' ') || `Ошибка запроса (${response.status})`)
  return body as T
}

export async function loadAlbums(): Promise<Album[]> {
  return parseResponse<Album[]>(await fetch('/api/albums', { credentials: 'include' }))
}

export async function getAlbum(id: string): Promise<Album> {
  const result = await parseResponse<AlbumDetailsResponse>(await fetch(`/api/album/${encodeURIComponent(id)}`, { credentials: 'include' }))
  return { ...result.album, tracks: result.tracks ?? result.album.tracks ?? [] }
}

export async function createAlbum(formData: FormData, accessToken: string): Promise<void> {
  await parseResponse<{ ok: boolean }>(await fetch('/api/upload-album', {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  }))
}

export async function authenticate(email: string, password: string, mode: 'login' | 'register'): Promise<AuthResponse> {
  return parseResponse<AuthResponse>(await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  }))
}