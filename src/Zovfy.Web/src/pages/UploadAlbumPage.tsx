import {
  useEffect,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  GripVertical,
  ImagePlus,
  LoaderCircle,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { parseBlob, type IPicture } from "music-metadata";
import "../styles/upload.css";
import type { PendingTrack } from "../types";

const audioExtensions = /\.(mp3|flac|opus)$/i;
const audioAccept = ".mp3,.flac,.opus,audio/mpeg,audio/flac,audio/ogg";
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

type Tags = {
  album?: string;
  artist?: string;
  year?: number;
  genre?: string;
  picture?: IPicture;
  no?: number | null;
};

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} МБ`;
}

async function readFile(file: File) {
  const track: PendingTrack = {
    id: crypto.randomUUID(),
    file,
    title: file.name.replace(/\.[^.]+$/, ""),
    artist: "",
    duration: null,
    lyricsLrc: "",
    lyricsTtml: "",
  };
  let tags: Tags = {};
  try {
    const { common, format } = await parseBlob(file, { duration: true });
    track.title = common.title?.trim() || track.title;
    track.artist = common.artist?.trim() || common.albumartist?.trim() || "";
    track.duration = Number.isFinite(format.duration)
      ? (format.duration ?? null)
      : null;
    tags = {
      album: common.album,
      artist: common.albumartist || common.artist,
      year: common.year,
      genre: common.genre?.[0],
      picture: common.picture?.[0],
      no: common.track.no,
    };
  } catch {
    // Keep the filename fallback when tags cannot be read.
  }
  return { track, tags };
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
  const [coverUrl, setCoverUrl] = useState("");
  const [tracks, setTracks] = useState<PendingTrack[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!cover) {
      setCoverUrl("");
      return;
    }
    const url = URL.createObjectURL(cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const totalSize = tracks.reduce((sum, t) => sum + t.file.size, 0);

  function patchTrack(id: string, patch: Partial<PendingTrack>) {
    setTracks((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function moveTrack(from: number, to: number) {
    setTracks((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function addTracks(fileList: FileList | null) {
    if (!fileList) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    Array.from(fileList).forEach((file) => {
      const duplicate = tracks.some(
        (t) => t.file.name === file.name && t.file.size === file.size,
      );
      if (!audioExtensions.test(file.name))
        rejected.push(`${file.name} (формат)`);
      else if (!file.size || file.size > maxTrackSize)
        rejected.push(`${file.name} (больше 100 МБ)`);
      else if (!duplicate) accepted.push(file);
    });

    setReading(true);
    const parsed = await Promise.all(accepted.map(readFile));
    setReading(false);

    // New files go in album order: by track number in tags, then by file name.
    parsed.sort(
      (a, b) =>
        (a.tags.no ?? 9999) - (b.tags.no ?? 9999) ||
        a.track.file.name.localeCompare(b.track.file.name, undefined, {
          numeric: true,
        }),
    );
    setTracks((current) => [...current, ...parsed.map((p) => p.track)]);

    // Fill empty album fields from the tags of the first tagged file.
    const first = parsed.find((p) => p.tags.album || p.tags.artist)?.tags;
    let filled = false;
    if (first) {
      if (!albumName && first.album) {
        setAlbumName(first.album.trim());
        filled = true;
      }
      if (!artist && first.artist) {
        setArtist(first.artist.trim());
        filled = true;
      }
      if (!year && first.year) {
        setYear(String(first.year));
        filled = true;
      }
      if (!genreChoice && first.genre) {
        const known = genres.find(
          (g) => g.toLowerCase() === first.genre?.toLowerCase(),
        );
        if (known) setGenreChoice(known);
        else {
          setGenreChoice("custom");
          setCustomGenre(first.genre);
        }
        filled = true;
      }
    }
    const picture = parsed.find((p) => p.tags.picture)?.tags.picture;
    if (picture && !cover) {
      const ext = picture.format.includes("png") ? "png" : "jpg";
      setCover(
        new File([new Uint8Array(picture.data)], `cover.${ext}`, {
          type: picture.format,
        }),
      );
      filled = true;
    }
    setNotice(filled ? "Данные альбома взяты из тегов — проверьте их." : "");
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
    formData.append(
      "trackLyricsLrc",
      JSON.stringify(tracks.map((track) => track.lyricsLrc)),
    );
    formData.append(
      "trackLyricsTtml",
      JSON.stringify(tracks.map((track) => track.lyricsTtml)),
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

  const isFileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  function handleGripKey(event: KeyboardEvent, index: number) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    moveTrack(index, to);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-grip="${to}"]`)?.focus(),
    );
  }

  return (
    <form
      className={`album-form${tracks.length > 0 && tracks.length <= 2 ? " album-form--single" : ""}`}
      onSubmit={handleSubmit}
    >
      {error && (
        <div className="message message-error" role="alert">
          {error}
        </div>
      )}
      {notice && !error && <div className="message">{notice}</div>}

      <section className="album-head">
        <div className="cover-column">
          <label
            className={`cover-art${coverUrl ? " has-cover" : ""}${submitting ? " is-sending" : ""}`}
          >
            <span className="vinyl" aria-hidden="true" />
            <span className="cover-face">
              {coverUrl ? (
                <img src={coverUrl} alt="Обложка альбома" />
              ) : (
                <>
                  <ImagePlus size={28} />
                  <strong>Обложка</strong>
                  <small>Нажмите, чтобы выбрать</small>
                </>
              )}
            </span>
            <input
              type="file"
              accept="image/*"
              aria-label="Обложка альбома"
              onChange={(event) => setCover(event.target.files?.[0] ?? null)}
            />
          </label>
          {cover && (
            <button
              type="button"
              className="text-button"
              onClick={() => setCover(null)}
            >
              Убрать обложку
            </button>
          )}
        </div>

        <div className="form-fields">
          <label className="field">
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
            <label className="field">
              Исполнитель
              <input
                required
                maxLength={120}
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                placeholder="Имя артиста"
              />
            </label>
            <label className="field">
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
          <label className="field">
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
            <label className="field">
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
        </div>
      </section>

      <section
        className={`track-section${dropping ? " is-dropping" : ""}`}
        onDragOver={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDropping(false);
        }}
        onDrop={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setDropping(false);
          void addTracks(event.dataTransfer.files);
        }}
      >
        <div className="track-section-heading">
          <div>
            <h2>Треки</h2>
            <p>
              {tracks.length
                ? `${tracks.length} шт.${totalDuration ? `, ${formatDuration(totalDuration)}` : ""}. Порядок можно менять перетаскиванием.`
                : "MP3, FLAC или OPUS до 100 МБ на файл."}
            </p>
          </div>
          {tracks.length > 0 && (
            <label className="secondary-button">
              {reading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              Добавить треки
              <input
                type="file"
                accept={audioAccept}
                multiple
                onChange={(event) => {
                  void addTracks(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        {tracks.length ? (
          <ol className="pending-tracks">
            {tracks.map((track, index) => (
              <li
                key={track.id}
                className={`${dragFrom === index ? "is-dragging" : ""}${dragOver === index && dragFrom !== index ? " is-over" : ""}`}
                onDragOver={(event) => {
                  if (dragFrom === null) return;
                  event.preventDefault();
                  setDragOver(index);
                }}
                onDrop={(event) => {
                  if (dragFrom === null) return;
                  event.preventDefault();
                  moveTrack(dragFrom, index);
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <button
                  type="button"
                  className="grip"
                  draggable
                  data-grip={index}
                  aria-label={`Переместить трек ${index + 1}. Стрелки вверх и вниз меняют порядок`}
                  onKeyDown={(event) => handleGripKey(event, index)}
                  onDragStart={(event) => {
                    const row = event.currentTarget.closest("li");
                    if (row) event.dataTransfer.setDragImage(row, 16, 24);
                    event.dataTransfer.effectAllowed = "move";
                    setDragFrom(index);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                >
                  <GripVertical size={16} />
                </button>
                <span className="track-number">{index + 1}</span>
                <div className="track-fields">
                  <input
                    aria-label={`Название трека ${index + 1}`}
                    value={track.title}
                    onChange={(event) =>
                      patchTrack(track.id, { title: event.target.value })
                    }
                  />
                  <input
                    aria-label={`Исполнитель трека ${index + 1}`}
                    placeholder={artist || "Исполнитель"}
                    value={track.artist}
                    onChange={(event) =>
                      patchTrack(track.id, { artist: event.target.value })
                    }
                  />
                  <small>
                    {track.file.name}, {formatSize(track.file.size)}
                  </small>
                </div>
                <span className="track-time">
                  {formatDuration(track.duration)}
                </span>
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
                <details className="track-lyrics-fields">
                  <summary>
                    Текст песни
                    {(track.lyricsLrc || track.lyricsTtml) && (
                      <i className="dot" aria-label="текст добавлен" />
                    )}
                  </summary>
                  <textarea
                    aria-label={`Текст LRC для трека ${index + 1}`}
                    maxLength={1_000_000}
                    placeholder="LRC-текст с временными метками"
                    value={track.lyricsLrc}
                    onChange={(event) =>
                      patchTrack(track.id, { lyricsLrc: event.target.value })
                    }
                  />
                  <textarea
                    aria-label={`Текст TTML для трека ${index + 1}`}
                    maxLength={1_000_000}
                    placeholder="TTML/XML текст с временными метками"
                    value={track.lyricsTtml}
                    onChange={(event) =>
                      patchTrack(track.id, { lyricsTtml: event.target.value })
                    }
                  />
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <label className="drop-zone">
            {reading ? (
              <LoaderCircle className="spin" size={26} />
            ) : (
              <Upload size={26} />
            )}
            <strong>
              {dropping ? "Отпустите, чтобы добавить" : "Перетащите файлы сюда"}
            </strong>
            <span>или нажмите, чтобы выбрать с устройства</span>
            <input
              type="file"
              accept={audioAccept}
              multiple
              onChange={(event) => {
                void addTracks(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </section>

      <div className="form-actions">
        <span className="form-summary">
          {tracks.length
            ? `${tracks.length} треков, ${formatSize(totalSize)}`
            : "Пока нет треков"}
        </span>
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
          {submitting ? "Загружаем…" : "Загрузить альбом"}
        </button>
      </div>
    </form>
  );
}
