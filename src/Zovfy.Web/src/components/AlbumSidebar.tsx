import { Compass, Home, ListMusic, Play, Plus } from "lucide-react";
import type { Album, Screen } from "../types";

type Props = {
  albums: Album[];
  screen: Screen;
  expanded: boolean;
  onNavigate: (screen: Screen) => void;
};

export function AlbumSidebar({ albums, screen, expanded, onNavigate }: Props) {
  const visibleAlbums = albums.slice(0, 6);

  const navItems = [
    { key: "home", label: "Главная", screen: "home" as const, icon: Home },
    {
      key: "navigator",
      label: "Навигатор",
      screen: "albums" as const,
      icon: Compass,
    },
    {
      key: "library",
      label: "Медиатека",
      screen: "albums" as const,
      icon: ListMusic,
    },
    {
      key: "create",
      label: "Создать плейлист",
      screen: "create" as const,
      icon: Plus,
    },
  ];

  return (
    <aside className={`music-sidebar ${expanded ? "expanded" : ""}`}>
      <nav className="music-nav" aria-label="Навигация">
        {navItems.map(({ key, label, screen: itemScreen, icon: Icon }) => {
          const isActive =
            itemScreen === "home"
              ? screen === "home"
              : itemScreen === "albums"
                ? screen === "albums" ||
                  screen === "detail" ||
                  screen === "artist"
                : screen === "create";

          return (
            <button
              key={key}
              type="button"
              className={isActive ? "active" : ""}
              data-tooltip={label}
              onClick={() => onNavigate(itemScreen)}
            >
              <span className="nav-icon">
                <Icon size={18} />
              </span>
              <span className="nav-text">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="music-playlist-list">
        <button
          type="button"
          className="music-playlist liked"
          data-tooltip="Любимые треки"
          onClick={() => onNavigate("albums")}
        >
          <span className="playlist-cover playlist-liked">
            <Play size={12} />
          </span>
          <span className="playlist-info">
            <span className="playlist-name">Любимые треки</span>
            <span className="playlist-type">0 треков</span>
          </span>
          <span
            className="mini-play-btn"
            data-tooltip="Воспроизвести любимые треки"
          >
            <Play size={10} />
          </span>
        </button>

        {visibleAlbums.map((album) => (
          <button
            key={album.id}
            type="button"
            className="music-playlist"
            data-tooltip={`${album.name} — ${album.artist}`}
            onClick={() => onNavigate("albums")}
          >
            {album.coverUrl ? (
              <img
                className="playlist-cover"
                src={album.coverUrl}
                alt={album.name}
              />
            ) : (
              <span className="playlist-cover playlist-fallback">
                {album.name.slice(0, 1)}
              </span>
            )}
            <span className="playlist-info">
              <span className="playlist-name">{album.name}</span>
              <span className="playlist-type">Альбом</span>
            </span>
            <span
              className="mini-play-btn"
              data-tooltip={`Воспроизвести: ${album.name}`}
            >
              <Play size={10} />
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
