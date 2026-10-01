import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Disc3, Edit3, Music2, X } from "lucide-react";
import { getArtist, type ArtistProfile } from "../api";
import type { Album } from "../types";
import "../styles/artist.css";

type Props = {
  name: string;
  accessToken: string | null;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (name: string) => void;
  onBack: () => void;
  onSave: (name: string, formData: FormData) => Promise<ArtistProfile>;
};

export function ArtistPage({
  name,
  accessToken,
  onOpenAlbum,
  onOpenArtist,
  onBack,
  onSave,
}: Props) {
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getArtist(name, accessToken)
      .then((profile) => {
        if (active) setArtist(profile);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Не удалось загрузить артиста.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [name, accessToken]);

  useEffect(() => {
    if (!editOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setEditOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editOpen]);

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!artist) return;
    setSaving(true);
    setError("");
    try {
      const updated = await onSave(
        artist.name,
        new FormData(event.currentTarget),
      );
      setArtist(updated);
      setEditOpen(false);
      setNotice("Профиль артиста обновлён.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось сохранить изменения.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="artist-loading">Загружаю артиста…</div>;
  if (error && !artist)
    return (
      <div className="artist-loading" role="alert">
        <p>{error}</p>
        <button className="artist-back" onClick={onBack} type="button">
          <ArrowLeft size={17} /> К каталогу
        </button>
      </div>
    );
  if (!artist) return null;

  return (
    <div className="artist-page">
      <section
        className="artist-hero"
        style={
          artist.bannerUrl
            ? {
                backgroundImage: `linear-gradient(0deg, #111 0%, rgb(17 17 17 / 15%) 100%), url("${artist.bannerUrl}")`,
              }
            : undefined
        }
      >
        <div className="artist-hero-shade" />
        <div className="artist-hero-inner">
          <button className="artist-back" onClick={onBack} type="button">
            <ArrowLeft size={17} /> К каталогу
          </button>
          <div className="artist-heading">
            {artist.avatarUrl ? (
              <img className="artist-avatar" src={artist.avatarUrl} alt="" />
            ) : (
              <span className="artist-avatar artist-avatar-fallback">
                <Music2 size={34} />
              </span>
            )}
            <div className="artist-heading-copy">
              <span className="artist-eyebrow">Артист</span>
              <h1>{artist.name}</h1>
              <p>
                {artist.releases.length} релизов ·{" "}
                {artist.totalPlays.toLocaleString("ru-RU")} прослушиваний
              </p>
            </div>
            {artist.canEdit && (
              <button
                className="artist-edit-button"
                onClick={() => setEditOpen(true)}
                type="button"
                aria-label="Редактировать профиль артиста"
                title="Редактировать профиль"
              >
                <Edit3 size={18} />
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="artist-body">
        {notice && (
          <p className="artist-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="artist-error" role="alert">
            {error}
          </p>
        )}
        {artist.description && (
          <p className="artist-description">{artist.description}</p>
        )}
        <div className="artist-releases-heading">
          <h2>Релизы</h2>
          <span>{artist.releases.length}</span>
        </div>
        {artist.releases.length ? (
          <div className="artist-releases">
            {artist.releases.map((release) => (
              <article className="artist-release" key={release.id}>
                <button
                  className="artist-release-cover"
                  type="button"
                  onClick={() => onOpenAlbum(release)}
                  aria-label={`Открыть альбом ${release.name}`}
                >
                  {release.coverUrl ? (
                    <img src={release.coverUrl} alt="" />
                  ) : (
                    <Disc3 size={30} />
                  )}
                </button>
                <button
                  className="artist-release-title"
                  type="button"
                  onClick={() => onOpenAlbum(release)}
                >
                  {release.name}
                </button>
                <span>
                  {release.year || "Год не указан"} · {release.trackCount ?? 0}{" "}
                  треков
                </span>
                {release.artist.toLocaleLowerCase() !==
                  artist.name.toLocaleLowerCase() && (
                  <button
                    className="artist-release-artist"
                    type="button"
                    onClick={() => onOpenArtist(release.artist)}
                  >
                    {release.artist}
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="artist-empty">У артиста пока нет релизов.</p>
        )}
      </section>

      {editOpen && (
        <div
          className="artist-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditOpen(false);
          }}
        >
          <section
            className="artist-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artist-edit-title"
          >
            <header>
              <h2 id="artist-edit-title">Профиль артиста</h2>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                aria-label="Закрыть"
              >
                <X size={19} />
              </button>
            </header>
            <form onSubmit={submitEdit}>
              <label>
                Описание
                <textarea
                  name="description"
                  defaultValue={artist.description ?? ""}
                  maxLength={5000}
                  rows={6}
                />
              </label>
              <label>
                Аватар
                <input
                  name="avatar"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </label>
              <label>
                Баннер
                <input
                  name="banner"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </label>
              <footer>
                <button
                  className="artist-cancel-button"
                  type="button"
                  onClick={() => setEditOpen(false)}
                >
                  Отмена
                </button>
                <button
                  className="artist-save-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Сохраняю…" : "Сохранить"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
