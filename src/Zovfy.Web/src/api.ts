import type { Album, AlbumDetailsResponse, AuthResponse, Track } from "./types";

type ApiError = { error?: string; message?: string; errors?: string[] };

export async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok)
    throw new Error(
      body.message ||
        body.error ||
        body.errors?.join(" ") ||
        `Ошибка запроса (${response.status})`,
    );
  return body as T;
}

export async function loadAlbums(): Promise<Album[]> {
  return parseResponse<Album[]>(
    await fetch("/api/albums", { credentials: "include" }),
  );
}

export async function getAlbum(id: string): Promise<Album> {
  const result = await parseResponse<AlbumDetailsResponse>(
    await fetch(`/api/album/${encodeURIComponent(id)}`, {
      credentials: "include",
    }),
  );
  return {
    ...result.album,
    tracks: result.tracks ?? result.album.tracks ?? [],
  };
}

export async function createAlbum(
  formData: FormData,
  accessToken: string,
): Promise<void> {
  await parseResponse<{ ok: boolean }>(
    await fetch("/api/upload-album", {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    }),
  );
}

export async function authenticate(
  email: string,
  password: string,
  mode: "login" | "register",
): Promise<AuthResponse> {
  return parseResponse<AuthResponse>(
    await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    }),
  );
}

export async function recordListening(
  trackId: string,
  playSessionId: string,
): Promise<void> {
  const accessToken = localStorage.getItem("zovfy.accessToken");
  await parseResponse<{ counted: boolean }>(
    await fetch(`/api/tracks/${encodeURIComponent(trackId)}/listen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ playSessionId }),
      credentials: "include",
    }),
  );
}

export type UserLikes = {
  albums: { id: string }[];
  tracks: { id: string }[];
};

export async function loadMyLikes(accessToken: string): Promise<UserLikes> {
  return parseResponse<UserLikes>(
    await fetch("/api/users/me/likes", {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    }),
  );
}

export async function updateLike(
  type: "albums" | "tracks",
  id: string,
  liked: boolean,
): Promise<void> {
  const accessToken = localStorage.getItem("zovfy.accessToken");
  if (!accessToken) return;
  const response = await fetch(
    `/api/users/me/likes/${type}/${encodeURIComponent(id)}`,
    {
      method: liked ? "PUT" : "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    },
  );
  if (!response.ok)
    throw new Error(`Не удалось сохранить лайк (${response.status}).`);
}

export type UserProfile = {
  id: string;
  email: string;
  description?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  roles: string[];
};

export type ArtistProfile = {
  name: string;
  description?: string | null;
  bannerUrl?: string | null;
  avatarUrl?: string | null;
  totalPlays: number;
  releases: Album[];
};

export type ChartEntry = {
  rank: number;
  playCount: number;
  windowStart: string;
  calculatedAt: string;
  track: Track & { album: Album };
};

export async function loadMyProfile(accessToken: string): Promise<UserProfile> {
  return parseResponse<UserProfile>(
    await fetch("/api/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    }),
  );
}

export async function updateMyProfile(
  formData: FormData,
  accessToken: string,
): Promise<UserProfile> {
  return parseResponse<UserProfile>(
    await fetch("/api/users/me", {
      method: "PUT",
      body: formData,
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    }),
  );
}

export async function getArtist(name: string): Promise<ArtistProfile> {
  return parseResponse<ArtistProfile>(
    await fetch(`/api/artists/${encodeURIComponent(name)}`),
  );
}

export async function updateArtist(
  name: string,
  formData: FormData,
  accessToken: string,
): Promise<void> {
  await parseResponse<{ ok: boolean }>(
    await fetch(`/api/artists/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: formData,
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
}

export async function getChart(): Promise<ChartEntry[]> {
  return parseResponse<ChartEntry[]>(await fetch("/api/chart"));
}
