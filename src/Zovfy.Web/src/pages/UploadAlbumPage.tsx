import { useState, type FormEvent } from "react";
import { LoaderCircle, Plus, Upload, X } from "lucide-react";
import { parseBlob } from "music-metadata";
import "../styles/upload.css";
import type { PendingTrack } from "../types";

const audioExtensions = /\.(mp3|flac|opus)$/i;
const maxTrackSize = 100 * 1024 * 1024;
const genres = [
  "Поп",
  "Рок",
  "Хип-хоп",
  "Электронная",
  "Джаз",
  "Классика",
  "Метал",
  "Инди",
  "R&B",
  "Фолк",
  "Саундтрек",
];
type Props = {
  authenticated: boolean;
  onSubmit: (formData: FormData) => Promise<void>;
  onRequireAuth: () => void;
  onCancel: () => void;
};

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function UploadAlbumPage({
  authenticated,
  onSubmit,
  onRequireAuth,
  onCancel,
}: Props) {
  const [albumName, setAlbumName] = useState("");
  const [artist, setArtist] = useState("");
  const [genreChoice, setGenreChoice] = useState("");
  const [customGenre, setCustomGenre] = useState("");
  const [year, setYear] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [tracks, setTracks] = useState<PendingTrack[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function addTracks(fileList: FileList | null) {
    if (!fileList) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    Array.from(fileList).forEach((file) => {
      if (!audioExtensions.test(file.name))
        rejected.push(`${file.name} (формат)`);
      else if (!file.size || file.size > maxTrackSize)
        rejected.push(`${file.name} (больше 100 МБ)`);
      else accepted.push(file);
    });
    const added = await Promise.all(
      accepted.map(async (file): Promise<PendingTrack> => {
        const track: PendingTrack = {
          id: crypto.randomUUID(),
          file,
          title: file.name.replace(/\.[^.]+$/, ""),
          artist: "",
          duration: null,
        };
        try {
          const metadata = await parseBlob(file, { duration: true });
          track.title = metadata.common.title?.trim() || track.title;
          track.artist =
            metadata.common.artist?.trim() ||
            metadata.common.albumartist?.trim() ||
            "";
          track.duration = Number.isFinite(metadata.format.duration)
            ? (metadata.format.duration ?? null)
            : null;
        } catch {
          // Keep the filename fallback when tags cannot be read.
        }
        return track;
      }),
    );
    setTracks((current) => [...current, ...added]);
    setError(
      rejected.length
        ? `Не добавлены файлы: ${rejected.join(", ")}. Разрешены MP3, FLAC и OPUS до 100 МБ.`
        : "",
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tracks.length) {
      setError("Добавьте хотя бы один аудиотрек.");
      return;
    }
    setError("");
    setSubmitting(true);
    const formData = new FormData();
    formData.append("name", albumName.trim());
    formData.append("artist", artist.trim());
    const genre = genreChoice === "custom" ? customGenre.trim() : genreChoice;
    if (genre) formData.append("genre", genre);
    if (year) formData.append("year", year);
    if (cover) formData.append("cover", cover);
    formData.append(
      "trackTitles",
      JSON.stringify(
        tracks.map((track) => track.title.trim() || track.file.name),
      ),
    );
    formData.append(
      "trackArtists",
      JSON.stringify(
        tracks.map((track) => track.artist.trim() || artist.trim()),
      ),
    );
    formData.append(
      "trackDurations",
      JSON.stringify(tracks.map((track) => track.duration)),
    );
    formData.append(
      "trackOrders",
      JSON.stringify(tracks.map((_, index) => index + 1)),
    );
    tracks.forEach((track) => formData.append("tracks", track.file));
    try {
      await onSubmit(formData);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось отправить альбом.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="album-form" onSubmit={handleSubmit}>
      {error && (
        <div className="message message-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-intro">
        <h2>Информация об альбоме</h2>
        <p>Заполните данные и добавьте аудиофайлы.</p>
      </div>
      <div className="form-fields">
        <label>
          Название альбома
          <input
            required
            maxLength={120}
            value={albumName}
            onChange={(event) => setAlbumName(event.target.value)}
            placeholder="Название"
          />
        </label>
        <div className="form-row">
          <label>
            Исполнитель
            <input
              required
              maxLength={120}
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              placeholder="Имя артиста"
            />
          </label>
          <label>
            Год выпуска
            <input
              type="number"
              min="1900"
              max="2100"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="2026"
            />
          </label>
        </div>
        <label>
          Жанр
          <select
            value={genreChoice}
            onChange={(event) => setGenreChoice(event.target.value)}
          >
            <option value="">Без жанра</option>
            {genres.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value="custom">Свой жанр</option>
          </select>
        </label>
        {genreChoice === "custom" && (
          <label>
            Свой жанр
            <input
              required
              maxLength={80}
              value={customGenre}
              onChange={(event) => setCustomGenre(event.target.value)}
              placeholder="Укажите жанр"
            />
          </label>
        )}
        <label className="file-picker">
          Обложка альбома <span>{cover?.name ?? "Выбрать изображение"}</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setCover(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <div className="track-section">
        <div className="track-section-heading">
          <div>
            <h2>Треки</h2>
            <p>MP3, FLAC или OPUS · до 100 МБ на файл</p>
          </div>
          <label className="secondary-button">
            <Plus size={16} />
            Добавить треки
            <input
              type="file"
              accept=".mp3,.flac,.opus,audio/mpeg,audio/flac,audio/ogg"
              multiple
              onChange={(event) => {
                void addTracks(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {tracks.length ? (
          <ol className="pending-tracks">
            {tracks.map((track, index) => (
              <li key={track.id}>
                <span className="track-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <input
                  aria-label={`Название трека ${index + 1}`}
                  value={track.title}
                  onChange={(event) =>
                    setTracks((current) =>
                      current.map((item) =>
                        item.id === track.id
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Исполнитель трека ${index + 1}`}
                  placeholder={artist || "Исполнитель"}
                  value={track.artist}
                  onChange={(event) =>
                    setTracks((current) =>
                      current.map((item) =>
                        item.id === track.id
                          ? { ...item, artist: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <small>
                  {track.file.name}
                  {track.duration ? ` · ${formatDuration(track.duration)}` : ""}
                </small>
                <button
                  type="button"
                  className="remove-track"
                  aria-label={`Удалить ${track.title}`}
                  onClick={() =>
                    setTracks((current) =>
                      current.filter((item) => item.id !== track.id),
                    )
                  }
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <label className="drop-zone">
            <Upload size={22} />
            <strong>Выберите аудиофайлы</strong>
            <span>MP3, FLAC или OPUS, до 100 МБ на файл</span>
            <input
              type="file"
              accept=".mp3,.flac,.opus,audio/mpeg,audio/flac,audio/ogg"
              multiple
              onChange={(event) => {
                void addTracks(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      <div className="form-actions">
        {authenticated ? (
          <button type="button" className="secondary-button" onClick={onCancel}>
            К альбомам
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={onRequireAuth}
          >
            Войти
          </button>
        )}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Upload size={17} />
          )}
          {submitting
            ? "Отправка…"
            : `Отправить альбом${tracks.length ? ` · ${tracks.length}` : ""}`}
        </button>
      </div>
    </form>
  );
}
