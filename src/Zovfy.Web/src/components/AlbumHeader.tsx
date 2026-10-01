import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Screen } from "../types";

type Props = {
  title: string;
  screen: Screen;
  authenticated: boolean;
  onNavigate: (screen: Screen) => void;
  onLogin: () => void;
  onLogout: () => void;
};

export function AlbumHeader({
  screen,
  authenticated,
  onNavigate,
  onLogin,
  onLogout,
}: Props) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className={`music-header${scrolled ? " scrolled" : ""}`}>
      <div className="music-header-spacer" />
      <div className="header-actions">
        <button
          className="secondary-button auth-trigger"
          onClick={authenticated ? onLogout : onLogin}
        >
          {authenticated ? "Выйти" : "Войти"}
        </button>
        {screen !== "create" && (
          <button
            className="primary-button"
            onClick={() => onNavigate("create")}
          >
            <Plus size={17} />
            Новый альбом
          </button>
        )}
      </div>
    </header>
  );
}
