import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import { parseBlob } from "music-metadata";
import type { Album, Track } from "../types";
import "../styles/album-edit.css";

type EditableTrack = {
  clientKey: string;
  id?: string;
  title: string;
  artist: string;
  order: number;
  duration: number | null;
  lyricsLrc: string;
  lyricsTtml: string;
  replacementFile: File | null;
};

type Props = {
  album: Album;
  onClose: () => void;
  onSave: (formData: FormData) => Promise<void>;
};

const maxAudioSize = 100 * 1024 * 1024;
const audioExtension = /\.(mp3|flac|opus)$/i;

async function readAudioDuration(file: File): Promise<number | null> {
  try {
    const metadata = await parseBlob(file, { duration: true });
    const duration = metadata.format.duration;
    return duration && Number.isFinite(duration) && duration > 0
      ? duration
      : null;
  } catch {
    return null;
  }
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "Не удалось определить";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function createEditableTrack(track: Track, index: number): EditableTrack {
  return {
    clientKey: track.id ?? crypto.randomUUID(),
    id: track.id,
    title: track.title,
    artist: track.artist ?? "",
    order: track.order ?? index + 1,
    duration: track.duration ?? null,
    lyricsLrc: track.lyricsLrc ?? "",
    lyricsTtml: track.lyricsTtml ?? "",
    replacementFile: null,
  };
}

export function AlbumEditModal({ album, onClose, onSave }: Props) {
  const [name, setName] = useState(album.name);
  const [artist, setArtist] = useState(album.artist);
  const [genre, setGenre] = useState(album.genre ?? "");
  const [year, setYear] = useState(album.year?.toString() ?? "");
  const [cover, setCover] = useState<File | null>(null);
  const [tracks, setTracks] = useState<EditableTrack[]>(() =>
    (album.tracks ?? []).map(createEditableTrack),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [processingAudio, setProcessingAudio] = useState(0);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  function updateTrack(clientKey: string, update: Partial<EditableTrack>) {
    setTracks((current) =>
      current.map((track) =>
        track.clientKey === clientKey ? { ...track, ...update } : track,
      ),
    );
  }

  async function addAudioFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const rejected: string[] = [];
    const valid = files.filter((file) => {
      if (
        !audioExtension.test(file.name) ||
        !file.size ||
        file.size > maxAudioSize
      ) {
        rejected.push(file.name);
        return false;
      }
      return true;
    });
    if (valid.length) setProcessingAudio((count) => count + 1);
    try {
      const durations = await Promise.all(valid.map(readAudioDuration));
      setTracks((current) => [
        ...current,
        ...valid.map((file, index) => ({
          clientKey: crypto.randomUUID(),
          title: file.name.replace(/\.[^.]+$/, ""),
          artist,
          order: current.length + index + 1,
          duration: durations[index],
          lyricsLrc: "",
          lyricsTtml: "",
          replacementFile: file,
        })),
      ]);
    } finally {
      if (valid.length) setProcessingAudio((count) => Math.max(0, count - 1));
    }
    setError(
      rejected.length
        ? `Не добавлены файлы: ${rejected.join(", ")}. Нужны MP3, FLAC или OPUS до 100 МБ.`
        : "",
    );
  }

  async function replaceAudio(clientKey: string, file?: File) {
    if (!file) return;
    if (
      !audioExtension.test(file.name) ||
      !file.size ||
      file.size > maxAudioSize
    ) {
      setError(
        `Недопустимый файл: ${file.name}. Нужен MP3, FLAC или OPUS до 100 МБ.`,
      );
      return;
    }
    setError("");
    setProcessingAudio((count) => count + 1);
    try {
      const duration = await readAudioDuration(file);
      updateTrack(clientKey, { replacementFile: file, duration });
    } finally {
      setProcessingAudio((count) => Math.max(0, count - 1));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tracks.length) {
      setError("В альбоме должен остаться хотя бы один трек.");
      return;
    }
    if (tracks.some((track) => !track.id && !track.replacementFile)) {
      setError("Для каждого нового трека выберите аудиофайл.");
      return;
    }

    const formData = new FormData();
    formData.append("name", name.trim());
    formData.append("artist", artist.trim());
    formData.append("genre", genre.trim());
    formData.append("year", year.trim());
    if (cover) formData.append("cover", cover);

    const fileIndexes: number[] = [];
    tracks.forEach((track, index) => {
      if (!track.replacementFile) return;
      fileIndexes.push(index);
      formData.append("trackFiles", track.replacementFile);
    });
    formData.append("trackFileTrackIndexes", JSON.stringify(fileIndexes));
    formData.append(
      "trackMetadata",
      JSON.stringify(
        tracks.map((track, index) => ({
          id: track.id ?? null,
          title: track.title.trim(),
          artist: track.artist.trim(),
          order: track.order || index + 1,
          duration: track.duration,
          lyricsLrc: track.lyricsLrc,
          lyricsTtml: track.lyricsTtml,
        })),
      ),
    );

    setSaving(true);
    setError("");
    try {
      await onSave(formData);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось сохранить альбом.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="album-edit-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="album-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-edit-title"
      >
        <header className="album-edit-header">
          <div>
            <span>РЕДАКТИРОВАНИЕ</span>
            <h2 id="album-edit-title">{album.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </header>

        <form className="album-edit-form" onSubmit={submit}>
          {error && (
            <p className="album-edit-error" role="alert">
              {error}
            </p>
          )}

          <div className="album-edit-fields">
            <label>
              Название альбома
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="album-edit-field-row">
              <label>
                Исполнитель
                <input
                  required
                  maxLength={120}
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                />
              </label>
              <label>
                Год
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </label>
              <label>
                Жанр
                <input
                  maxLength={80}
                  value={genre}
                  onChange={(event) => setGenre(event.target.value)}
                />
              </label>
            </div>
            <label className="album-edit-file-label">
              <span>
                Обложка{cover ? ` · ${cover.name}` : " · оставить текущую"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setCover(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="album-edit-tracks-heading">
            <div>
              <h3>Треки</h3>
              <span>
                {processingAudio
                  ? "Считываю длительность аудио…"
                  : `${tracks.length} в альбоме`}
              </span>
            </div>
            <label className="album-edit-add-track">
              <Plus size={16} /> Добавить треки
              <input
                type="file"
                accept=".mp3,.flac,.opus,audio/mpeg,audio/flac,audio/ogg"
                multiple
                onChange={addAudioFiles}
              />
            </label>
          </div>

          <div className="album-edit-track-list">
            {tracks.map((track, index) => (
              <fieldset className="album-edit-track" key={track.clientKey}>
                <legend>Трек {index + 1}</legend>
                <button
                  className="album-edit-remove-track"
                  type="button"
                  onClick={() =>
                    setTracks((current) =>
                      current.filter(
                        (item) => item.clientKey !== track.clientKey,
                      ),
                    )
                  }
                  aria-label={`Удалить трек ${index + 1}`}
                  title="Удалить трек"
                >
                  <Trash2 size={16} />
                </button>
                <div className="album-edit-track-fields">
                  <label>
                    Название
                    <input
                      required
                      maxLength={200}
                      value={track.title}
                      onChange={(event) =>
                        updateTrack(track.clientKey, {
                          title: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Исполнитель
                    <input
                      maxLength={120}
                      value={track.artist}
                      onChange={(event) =>
                        updateTrack(track.clientKey, {
                          artist: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    №
                    <input
                      type="number"
                      min="1"
                      value={track.order}
                      onChange={(event) =>
                        updateTrack(track.clientKey, {
                          order: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="album-edit-duration">
                    <span>Длительность</span>
                    <output>{formatDuration(track.duration)}</output>
                  </div>
                </div>
                <label className="album-edit-audio-label">
                  <Upload size={15} />
                  {track.replacementFile?.name ??
                    (track.id ? "Заменить аудиофайл" : "Выбрать аудиофайл")}
                  <input
                    type="file"
                    accept=".mp3,.flac,.opus,audio/mpeg,audio/flac,audio/ogg"
                    onChange={(event) => {
                      void replaceAudio(
                        track.clientKey,
                        event.target.files?.[0],
                      );
                      event.target.value = "";
                    }}
                  />
                </label>
                <details className="album-edit-lyrics">
                  <summary>Тексты песен · LRC / TTML</summary>
                  <label>
                    LRC
                    <textarea
                      maxLength={1_000_000}
                      rows={4}
                      value={track.lyricsLrc}
                      onChange={(event) =>
                        updateTrack(track.clientKey, {
                          lyricsLrc: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    TTML
                    <textarea
                      maxLength={1_000_000}
                      rows={4}
                      value={track.lyricsTtml}
                      onChange={(event) =>
                        updateTrack(track.clientKey, {
                          lyricsTtml: event.target.value,
                        })
                      }
                    />
                  </label>
                </details>
              </fieldset>
            ))}
          </div>

          <footer className="album-edit-footer">
            <button
              type="button"
              className="album-edit-cancel"
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="album-edit-save"
              disabled={saving || processingAudio > 0}
            >
              {saving
                ? "Сохраняю…"
                : processingAudio
                  ? "Считываю аудио…"
                  : "Сохранить изменения"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
