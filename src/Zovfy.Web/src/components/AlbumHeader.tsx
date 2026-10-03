import { Heart, LogOut, Plus, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  authenticated: boolean;
  avatarUrl: string | null;
  onLogin: () => void;
  onHome: () => void;
  onOpenLikes: () => void;
  onCreate: () => void;
  onLogout: () => void;
};

export function AlbumHeader({
  authenticated,
  avatarUrl,
  onLogin,
  onHome,
  onOpenLikes,
  onCreate,
  onLogout,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => setAvatarFailed(false), [avatarUrl]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  return (
    <header className={`music-header${scrolled ? " scrolled" : ""}`}>
      <button
        type="button"
        className="music-header-brand"
        aria-label="На главную"
        onClick={onHome}
      >
        <img src="/zovfy.svg" alt="Zovfy" />
      </button>
      <div className="header-actions">
        {authenticated ? (
          <div className="music-user-menu" ref={menuRef}>
            <button
              type="button"
              className="music-user-avatar"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Меню пользователя"
              aria-expanded={menuOpen}
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
            </button>

            {menuOpen && (
              <div className="music-user-menu-panel" role="menu">
                <button
                  type="button"
                  className="music-user-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenLikes();
                  }}
                >
                  <Heart size={15} />
                  Мои лайки
                </button>
                <button
                  type="button"
                  className="music-user-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onCreate();
                  }}
                >
                  <Plus size={15} />
                  Создать релиз
                </button>
                <button
                  type="button"
                  className="music-user-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={15} />
                  Выйти
                </button>
              </div>
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
