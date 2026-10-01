import { useEffect, useState } from "react";
import { authenticate, createAlbum, getAlbum, loadAlbums } from "./api";
import { AudioPlayer } from "./components/AudioPlayer";
import { AlbumHeader } from "./components/AlbumHeader";
import { AlbumSidebar } from "./components/AlbumSidebar";
import { AuthModal } from "./components/AuthModal";
import { AlbumDetailPage } from "./pages/AlbumDetailPage.tsx";
import { AlbumsPage } from "./pages/AlbumsPage";
import { HomePage } from "./pages/HomePage";
import { UploadAlbumPage } from "./pages/UploadAlbumPage";
import type { Album, Screen, Track } from "./types";
import "./tokens.css";
import "./styles/music-layout.css";

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessToken, setAccessToken] = useState(() =>
    localStorage.getItem("zovfy.accessToken"),
  );
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

  function navigate(next: Screen) {
    setScreen(next);
    setError("");
    setNotice("");
  }

  async function openAlbum(album: Album) {
    setSelectedAlbum(album);
    setScreen("detail");
    setLoadingDetail(true);
    setError("");
    try {
      setSelectedAlbum(await getAlbum(album.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Не удалось открыть альбом.",
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  async function submitAlbum(formData: FormData) {
    if (!accessToken) {
      setAuthOpen(true);
      throw new Error("Войдите или создайте аккаунт, чтобы загрузить альбом.");
    }
    await createAlbum(formData, accessToken);
    await refreshAlbums();
    setNotice("Альбом добавлен в каталог.");
    setScreen("albums");
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

  function logout() {
    localStorage.removeItem("zovfy.accessToken");
    setAccessToken(null);
    setNotice("Вы вышли из аккаунта.");
  }

  function playTracks(tracks: Track[], index: number, coverUrl?: string) {
    const queue = tracks.map((track) => ({ ...track, coverUrl }));
    const track = queue[index];
    if (track) {
      window.dispatchEvent(
        new CustomEvent("zovfy:play-track", { detail: { track, queue } }),
      );
    }
  }

  const title =
    screen === "create"
      ? "Новый альбом"
      : screen === "detail"
        ? (selectedAlbum?.name ?? "Альбом")
        : screen === "albums"
          ? "Альбомы"
          : "Главная";

  return (
    <div className="music-app">
      <AlbumSidebar screen={screen} onNavigate={navigate} />
      <main className="music-main">
        <AlbumHeader
          title={title}
          screen={screen}
          authenticated={Boolean(accessToken)}
          onNavigate={navigate}
          onLogin={() => setAuthOpen(true)}
          onLogout={logout}
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
              onCreate={() => navigate("create")}
            />
          )}
          {screen === "albums" && (
            <AlbumsPage
              albums={albums}
              loading={loading}
              onOpenAlbum={openAlbum}
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
      />
    </div>
  );
}

export default App;
