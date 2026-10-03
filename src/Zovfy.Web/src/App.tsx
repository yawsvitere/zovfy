import { useEffect, useRef, useState } from "react";
import {
  authenticate,
  createAlbum,
  getArtist,
  getAlbum,
  loadAlbums,
  loadMyLikes,
  loadMyProfile,
  updateAlbum,
  updateArtist,
} from "./api";
import { AudioPlayer } from "./components/AudioPlayer";
import { AlbumHeader } from "./components/AlbumHeader";
import { AuthModal } from "./components/AuthModal";
import { AlbumDetailPage } from "./pages/AlbumDetailPage.tsx";
import { AlbumsPage } from "./pages/AlbumsPage";
import { HomePage } from "./pages/HomePage";
import { UploadAlbumPage } from "./pages/UploadAlbumPage";
import { ArtistPage } from "./pages/ArtistPage";
import type { Album, Screen, Track } from "./types";
import "./tokens.css";
import "./styles/music-layout.css";

function App() {
  const appRef = useRef<HTMLDivElement | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState("");
  const [artistReturnScreen, setArtistReturnScreen] = useState<Screen>("home");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessToken, setAccessToken] = useState(() =>
    localStorage.getItem("zovfy.accessToken"),
  );
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trackDurations, setTrackDurations] = useState<Record<string, number>>(
    {},
  );

  async function refreshAlbums() {
    setLoading(true);
    setError("");
    try {
      setAlbums(await loadAlbums());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось загрузить альбомы.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAlbums();
  }, []);

  async function loadAlbumDetail(id: string, initialAlbum?: Album) {
    setSelectedAlbum(initialAlbum ?? null);
    setScreen("detail");
    setLoadingDetail(true);
    setError("");
    try {
      setSelectedAlbum(await getAlbum(id, accessToken));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Не удалось открыть альбом.",
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    function syncLocation() {
      const albumMatch = window.location.pathname.match(
        /^\/albums\/([^/]+)\/?$/,
      );
      if (albumMatch) {
        void loadAlbumDetail(decodeURIComponent(albumMatch[1]));
        return;
      }
      if (window.location.pathname.replace(/\/$/, "") === "/albums") {
        setScreen("albums");
        return;
      }
      const match = window.location.pathname.match(/^\/artist\/([^/]+)\/?$/);
      if (match) {
        setSelectedArtist(decodeURIComponent(match[1]));
        setScreen("artist");
      } else {
        setScreen(
          (window.history.state?.screen as Screen | undefined) ?? "home",
        );
      }
    }
    window.addEventListener("popstate", syncLocation);
    syncLocation();
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void loadMyLikes(accessToken)
      .then((likes) => {
        if (!active) return;
        localStorage.setItem(
          "zovfy.likedAlbums",
          JSON.stringify(likes.albums.map((album) => album.id)),
        );
        localStorage.setItem(
          "zovfy.likedTracks",
          JSON.stringify(likes.tracks.map((track) => track.id)),
        );
        window.dispatchEvent(new Event("zovfy:likes-changed"));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setUserAvatarUrl(null);
      return;
    }
    let active = true;
    void loadMyProfile(accessToken)
      .then((profile) => {
        if (active) setUserAvatarUrl(profile.avatarUrl ?? null);
      })
      .catch(() => {
        if (active) setUserAvatarUrl(null);
      });
    return () => {
      active = false;
    };
  }, [accessToken]);

  useEffect(() => {
    function updateAudioLevel(event: Event) {
      const level = (event as CustomEvent<number>).detail;
      appRef.current?.style.setProperty(
        "--music-bg-scale",
        String(1.08 + Math.max(0, Math.min(1, level)) * 0.32),
      );
    }

    window.addEventListener("zovfy:audio-level", updateAudioLevel);
    return () =>
      window.removeEventListener("zovfy:audio-level", updateAudioLevel);
  }, []);

  function navigate(next: Screen) {
    if (next !== "artist") {
      const path = next === "albums" ? "/albums" : "/";
      window.history.replaceState({ screen: next }, "", path);
    }
    setScreen(next);
    setError("");
    setNotice("");
  }

  function openArtist(name: string) {
    if (!name.trim()) return;
    setArtistReturnScreen(screen === "artist" ? artistReturnScreen : screen);
    window.history.pushState(
      { screen },
      "",
      `/artist/${encodeURIComponent(name.trim())}`,
    );
    setSelectedArtist(name.trim());
    setScreen("artist");
    setError("");
    setNotice("");
  }

  async function saveArtist(name: string, formData: FormData) {
    if (!accessToken)
      throw new Error("Войдите в аккаунт, чтобы редактировать артиста.");
    await updateArtist(name, formData, accessToken);
    return getArtist(name, accessToken);
  }

  async function openAlbum(album: Album) {
    window.history.pushState(
      { screen: "detail" },
      "",
      `/albums/${encodeURIComponent(album.id)}`,
    );
    await loadAlbumDetail(album.id, album);
  }

  async function saveAlbum(id: string, formData: FormData) {
    if (!accessToken)
      throw new Error("Войдите в аккаунт, чтобы редактировать альбом.");
    await updateAlbum(id, formData, accessToken);
    const updated = await getAlbum(id, accessToken);
    setSelectedAlbum(updated);
    setAlbums((current) =>
      current.map((album) =>
        album.id === updated.id
          ? {
              ...album,
              name: updated.name,
              artist: updated.artist,
              genre: updated.genre,
              year: updated.year,
              coverUrl: updated.coverUrl,
              trackCount: updated.trackCount,
            }
          : album,
      ),
    );
  }

  async function submitAlbum(formData: FormData) {
    if (!accessToken) {
      setAuthOpen(true);
      throw new Error("Войдите или создайте аккаунт, чтобы загрузить альбом.");
    }
    await createAlbum(formData, accessToken);
    await refreshAlbums();
    navigate("albums");
    setNotice("Альбом добавлен в каталог.");
  }

  async function completeAuth(
    email: string,
    password: string,
    mode: "login" | "register",
  ) {
    const result = await authenticate(email, password, mode);
    localStorage.setItem("zovfy.accessToken", result.accessToken);
    setAccessToken(result.accessToken);
    setAuthOpen(false);
    setNotice(
      mode === "register"
        ? "Аккаунт создан. Теперь можно загружать альбомы."
        : "Вы вошли в аккаунт.",
    );
  }

  function playTracks(
    tracks: Track[],
    index: number,
    coverUrl?: string,
    albumId?: string,
  ) {
    const queue = tracks.map((track) => ({
      ...track,
      coverUrl,
      albumId: track.albumId ?? albumId,
    }));
    const track = queue[index];
    if (track) {
      window.dispatchEvent(
        new CustomEvent("zovfy:play-track", { detail: { track, queue } }),
      );
    }
  }

  const backgroundCover = playingTrack?.coverUrl ?? selectedAlbum?.coverUrl;
  const appStyle = backgroundCover
    ? ({
        "--music-cover-image": `url("${backgroundCover.replaceAll('"', '\\"')}")`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={appRef}
      className={`music-app${isPlaying ? " is-playing" : ""}`}
      style={appStyle}
    >
      <main className="music-main">
        <AlbumHeader
          authenticated={Boolean(accessToken)}
          avatarUrl={userAvatarUrl}
          onLogin={() => setAuthOpen(true)}
          onHome={() => navigate("home")}
          onOpenLikes={() => navigate("albums")}
          onCreate={() => navigate("create")}
          onLogout={() => {
            localStorage.removeItem("zovfy.accessToken");
            setAccessToken(null);
            setUserAvatarUrl(null);
            setNotice("Вы вышли из аккаунта.");
          }}
        />
        <section className="music-content">
          {error && (
            <div className="message message-error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Закрыть">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="message message-success" role="status">
              {notice}
              <button onClick={() => setNotice("")} aria-label="Закрыть">
                ×
              </button>
            </div>
          )}
          {screen === "home" && (
            <HomePage
              albums={albums}
              loading={loading}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
              onCreate={() => navigate("create")}
            />
          )}
          {screen === "albums" && (
            <AlbumsPage
              albums={albums}
              loading={loading}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
              onCreate={() => navigate("create")}
            />
          )}
          {screen === "create" && (
            <UploadAlbumPage
              authenticated={Boolean(accessToken)}
              onSubmit={submitAlbum}
              onRequireAuth={() => setAuthOpen(true)}
              onCancel={() => navigate("albums")}
            />
          )}
          {screen === "detail" && (
            <AlbumDetailPage
              album={selectedAlbum}
              albums={albums}
              loading={loadingDetail}
              currentTrackId={playingTrack?.id ?? null}
              isPlaying={isPlaying}
              durations={trackDurations}
              onPlayTracks={playTracks}
              onBack={() => navigate("albums")}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
              onUpdateAlbum={saveAlbum}
            />
          )}
          {screen === "artist" && (
            <ArtistPage
              name={selectedArtist}
              accessToken={accessToken}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
              onSave={saveArtist}
            />
          )}
        </section>
      </main>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSubmit={completeAuth}
      />
      <AudioPlayer
        onTrackChange={setPlayingTrack}
        onPlayingChange={setIsPlaying}
        onDurationChange={(trackId, duration) =>
          setTrackDurations((current) => ({ ...current, [trackId]: duration }))
        }
        onOpenAlbum={(track) => {
          const album = albums.find((item) => item.id === track.albumId);
          if (album) void openAlbum(album);
        }}
        onOpenArtist={openArtist}
      />
    </div>
  );
}

export default App;
