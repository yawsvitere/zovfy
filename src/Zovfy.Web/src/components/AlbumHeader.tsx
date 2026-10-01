import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  authenticated: boolean;
  avatarUrl: string | null;
  sidebarExpanded: boolean;
  onLogin: () => void;
  onToggleSidebar: () => void;
};

export function AlbumHeader({
  authenticated,
  avatarUrl,
  sidebarExpanded,
  onLogin,
  onToggleSidebar,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => setAvatarFailed(false), [avatarUrl]);

  return (
    <header className={`music-header${scrolled ? " scrolled" : ""}`}>
      <button
        type="button"
        className="music-header-brand"
        onClick={onToggleSidebar}
        aria-label={sidebarExpanded ? "Свернуть меню" : "Развернуть меню"}
        aria-expanded={sidebarExpanded}
      >
        <img src="/zovfy.svg" alt="" />
      </button>
      <div className="header-actions">
        {authenticated ? (
          <div
            className="music-user-avatar"
            role="img"
            aria-label="Аватар пользователя"
          >
            {avatarUrl && !avatarFailed ? (
              <img
                src={avatarUrl}
                alt=""
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <UserRound size={20} />
            )}
          </div>
        ) : (
          <button
            type="button"
            className="music-user-avatar"
            onClick={onLogin}
            aria-label="Войти"
          >
            <UserRound size={20} />
          </button>
        )}
      </div>
    </header>
  );
}
