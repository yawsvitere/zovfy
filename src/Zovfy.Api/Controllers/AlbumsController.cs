using System.Security.Claims;
using System.Text.Json;
using Amazon.S3;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Zovfy.Api.Data;
using Zovfy.Api.Services;

namespace Zovfy.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class AlbumsController(AppDbContext database, ObjectStorageService storage) : ControllerBase
{
    private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".flac", ".opus"
    };
    private const long MaxTrackSize = 100 * 1024 * 1024;

    [HttpGet("albums")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAlbums(CancellationToken cancellationToken)
    {
        var albums = await database.Albums
            .Include(album => album.Tracks)
            .OrderByDescending(album => album.CreatedAt)
            .ToListAsync(cancellationToken);

        return Ok(albums.Select(album => ToResponse(album, includeTrackLyrics: false)));
    }

    [HttpGet("album/{id:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAlbum(Guid id, CancellationToken cancellationToken)
    {
        var album = await database.Albums
            .Include(item => item.Tracks)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        return album is null
            ? NotFound(new { message = "Альбом не найден." })
            : Ok(new
            {
                album = ToResponse(album, canEdit: CanManageAlbum(album)),
                tracks = album.Tracks.OrderBy(track => track.Order)
                    .Select(track => ToTrackResponse(track, includeLyrics: true))
            });
    }

    [HttpPost("upload-album")]
    [Authorize]
    [RequestSizeLimit(500_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 500_000_000)]
    public async Task<IActionResult> CreateAlbum([FromForm] CreateAlbumRequest request, CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        var artist = request.Artist.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(artist))
        {
            return BadRequest(new { message = "Укажите название альбома и исполнителя." });
        }

        if (request.Tracks.Count == 0)
        {
            return BadRequest(new { message = "Добавьте хотя бы один аудиотрек." });
        }

        var invalidTrack = request.Tracks.FirstOrDefault(track =>
            track.Length == 0 || track.Length > MaxTrackSize || !AudioExtensions.Contains(Path.GetExtension(track.FileName)));
        if (invalidTrack is not null)
        {
            return BadRequest(new { message = $"Недопустимый аудиофайл: {Path.GetFileName(invalidTrack.FileName)}. Разрешены MP3, FLAC и OPUS до 100 МБ." });
        }

        var genre = request.Genre?.Trim();
        if (genre?.Length > 80)
        {
            return BadRequest(new { message = "Название жанра не должно превышать 80 символов." });
        }

        if (request.Cover is { Length: > 10_000_000 })
        {
            return BadRequest(new { message = "Размер обложки не должен превышать 10 МБ." });
        }

        string[] titles;
        string[] trackArtists;
        int[] orders;
        double?[] durations;
        string?[] lyricsLrc;
        string?[] lyricsTtml;
        try
        {
            titles = JsonSerializer.Deserialize<string[]>(request.TrackTitles ?? "[]") ?? [];
            trackArtists = JsonSerializer.Deserialize<string[]>(request.TrackArtists ?? "[]") ?? [];
            orders = JsonSerializer.Deserialize<int[]>(request.TrackOrders ?? "[]") ?? [];
            durations = JsonSerializer.Deserialize<double?[]>(request.TrackDurations ?? "[]") ?? [];
            lyricsLrc = JsonSerializer.Deserialize<string?[]>(request.TrackLyricsLrc ?? "[]") ?? [];
            lyricsTtml = JsonSerializer.Deserialize<string?[]>(request.TrackLyricsTtml ?? "[]") ?? [];
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "Не удалось прочитать список треков." });
        }

        if (lyricsLrc.Concat(lyricsTtml).Any(lyrics => lyrics?.Length > 1_000_000))
        {
            return BadRequest(new { message = "Текст песни не должен превышать 1 МБ." });
        }

        var ownerClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(ownerClaim, out var ownerId))
        {
            return Unauthorized();
        }

        var album = new Album
        {
            Id = Guid.NewGuid(),
            Name = name,
            Artist = artist,
            Genre = string.IsNullOrWhiteSpace(genre) ? null : genre,
            Year = request.Year,
            OwnerId = ownerId,
            CreatedAt = DateTimeOffset.UtcNow
        };

        if (request.Cover is { Length: > 0 } cover)
        {
            await using var coverStream = cover.OpenReadStream();
            album.CoverObjectKey = await storage.UploadAsync(
                coverStream,
                Path.GetFileName(cover.FileName),
                cover.ContentType,
                cancellationToken);
        }

        for (var index = 0; index < request.Tracks.Count; index++)
        {
            var file = request.Tracks[index];
            await using var trackStream = file.OpenReadStream();
            var fileName = Path.GetFileName(file.FileName);
            var objectKey = await storage.UploadAsync(trackStream, fileName, file.ContentType, cancellationToken);
            album.Tracks.Add(new AlbumTrack
            {
                Id = Guid.NewGuid(),
                Title = index < titles.Length && !string.IsNullOrWhiteSpace(titles[index])
                    ? titles[index].Trim()
                    : Path.GetFileNameWithoutExtension(fileName),
                Artist = index < trackArtists.Length && !string.IsNullOrWhiteSpace(trackArtists[index])
                    ? trackArtists[index].Trim()
                    : artist,
                Order = index < orders.Length && orders[index] > 0 ? orders[index] : index + 1,
                FileName = fileName,
                ObjectKey = objectKey,
                ContentType = file.ContentType,
                Size = file.Length,
                Duration = index < durations.Length && durations[index] is { } duration && double.IsFinite(duration) && duration > 0
                    ? duration
                    : null,
                LyricsLrc = index < lyricsLrc.Length && !string.IsNullOrWhiteSpace(lyricsLrc[index])
                    ? lyricsLrc[index]
                    : null,
                LyricsTtml = index < lyricsTtml.Length && !string.IsNullOrWhiteSpace(lyricsTtml[index])
                    ? lyricsTtml[index]
                    : null
            });
        }

        database.Albums.Add(album);
        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { ok = true, message = "Альбом создан.", album = ToResponse(album) });
    }

    [HttpPut("album/{id:guid}")]
    [Authorize]
    [RequestSizeLimit(500_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 500_000_000)]
    public async Task<IActionResult> UpdateAlbum(
        Guid id,
        [FromForm] UpdateAlbumRequest request,
        CancellationToken cancellationToken)
    {
        var album = await database.Albums.Include(item => item.Tracks)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (album is null) return NotFound(new { message = "Альбом не найден." });
        if (!CanManageAlbum(album)) return Forbid();

        var name = request.Name.Trim();
        var artist = request.Artist.Trim();
        var genre = request.Genre?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 120 ||
            string.IsNullOrWhiteSpace(artist) || artist.Length > 120)
        {
            return BadRequest(new { message = "Название альбома и исполнитель обязательны (до 120 символов)." });
        }
        if (genre?.Length > 80 || request.Year is < 1900 or > 2100)
        {
            return BadRequest(new { message = "Проверьте жанр и год выпуска альбома." });
        }
        if (request.Cover is { Length: > 10_000_000 })
        {
            return BadRequest(new { message = "Размер обложки не должен превышать 10 МБ." });
        }
        List<UpdateAlbumTrackMetadata> trackMetadata;
        int[] fileIndexes;
        try
        {
            var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
            trackMetadata = JsonSerializer.Deserialize<List<UpdateAlbumTrackMetadata>>(
                request.TrackMetadata ?? "[]", jsonOptions) ?? [];
            fileIndexes = JsonSerializer.Deserialize<int[]>(request.TrackFileTrackIndexes ?? "[]") ?? [];
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "Не удалось прочитать данные треков." });
        }

        if (trackMetadata.Count == 0 || trackMetadata.Count > 500 ||
            trackMetadata.Any(track => string.IsNullOrWhiteSpace(track.Title) || track.Title.Length > 200 ||
                track.Artist?.Length > 120 || track.LyricsLrc?.Length > 1_000_000 || track.LyricsTtml?.Length > 1_000_000))
        {
            return BadRequest(new { message = "Проверьте названия, исполнителей и тексты треков." });
        }
        if (fileIndexes.Length != request.TrackFiles.Count ||
            fileIndexes.Any(index => index < 0 || index >= trackMetadata.Count) ||
            fileIndexes.Distinct().Count() != fileIndexes.Length)
        {
            return BadRequest(new { message = "Не удалось сопоставить аудиофайлы с треками." });
        }

        var invalidFile = request.TrackFiles.FirstOrDefault(file => file.Length == 0 ||
            file.Length > MaxTrackSize || !AudioExtensions.Contains(Path.GetExtension(file.FileName)));
        if (invalidFile is not null)
        {
            return BadRequest(new { message = $"Недопустимый аудиофайл: {Path.GetFileName(invalidFile.FileName)}. Разрешены MP3, FLAC и OPUS до 100 МБ." });
        }

        var existingTracks = album.Tracks.ToDictionary(track => track.Id);
        var retainedIds = new HashSet<Guid>();
        var fileByTrackIndex = fileIndexes.Select((trackIndex, fileIndex) => (trackIndex, fileIndex))
            .ToDictionary(item => item.trackIndex, item => request.TrackFiles[item.fileIndex]);
        var updatedTracks = new List<AlbumTrack>(trackMetadata.Count);

        for (var index = 0; index < trackMetadata.Count; index++)
        {
            var metadata = trackMetadata[index];
            AlbumTrack track;
            if (!string.IsNullOrWhiteSpace(metadata.Id))
            {
                if (!Guid.TryParse(metadata.Id, out var trackId) ||
                    !existingTracks.TryGetValue(trackId, out track!) || !retainedIds.Add(trackId))
                {
                    return BadRequest(new { message = "В списке указан неизвестный или повторяющийся трек." });
                }
            }
            else
            {
                if (!fileByTrackIndex.ContainsKey(index))
                {
                    return BadRequest(new { message = "Для нового трека выберите аудиофайл." });
                }
                track = new AlbumTrack { Id = Guid.NewGuid(), AlbumId = album.Id };
                retainedIds.Add(track.Id);
                database.AlbumTracks.Add(track);
            }

            track.Title = metadata.Title.Trim();
            track.Artist = string.IsNullOrWhiteSpace(metadata.Artist) ? artist : metadata.Artist.Trim();
            track.Order = metadata.Order > 0 ? metadata.Order : index + 1;
            track.Duration = metadata.Duration is { } duration && double.IsFinite(duration) && duration > 0
                ? duration
                : null;
            track.LyricsLrc = string.IsNullOrWhiteSpace(metadata.LyricsLrc) ? null : metadata.LyricsLrc;
            track.LyricsTtml = string.IsNullOrWhiteSpace(metadata.LyricsTtml) ? null : metadata.LyricsTtml;

            if (fileByTrackIndex.TryGetValue(index, out var audioFile))
            {
                await using var stream = audioFile.OpenReadStream();
                track.FileName = Path.GetFileName(audioFile.FileName);
                track.ObjectKey = await storage.UploadAsync(stream, track.FileName, audioFile.ContentType, cancellationToken);
                track.ContentType = audioFile.ContentType;
                track.Size = audioFile.Length;
            }

            updatedTracks.Add(track);
        }

        var removedTracks = album.Tracks
            .Where(track => !retainedIds.Contains(track.Id))
            .ToList();
        database.AlbumTracks.RemoveRange(removedTracks);
        album.Tracks = updatedTracks;
        album.Name = name;
        album.Artist = artist;
        album.Genre = string.IsNullOrWhiteSpace(genre) ? null : genre;
        album.Year = request.Year;

        if (request.Cover is { Length: > 0 } cover)
        {
            await using var stream = cover.OpenReadStream();
            album.CoverObjectKey = await storage.UploadAsync(stream, Path.GetFileName(cover.FileName), cover.ContentType, cancellationToken);
        }

        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { ok = true, album = ToResponse(album, canEdit: true) });
    }

    [HttpGet("albums/{id:guid}/cover")]
    [AllowAnonymous]
    public async Task<IActionResult> GetCover(Guid id, CancellationToken cancellationToken)
    {
        var objectKey = await database.Albums
            .Where(album => album.Id == id)
            .Select(album => album.CoverObjectKey)
            .FirstOrDefaultAsync(cancellationToken);
        return await GetStoredFile(objectKey, cancellationToken);
    }

    [HttpGet("tracks/{id:guid}/file")]
    [AllowAnonymous]
    public async Task<IActionResult> GetTrackFile(Guid id, CancellationToken cancellationToken)
    {
        var track = await database.AlbumTracks
            .Where(item => item.Id == id)
            .Select(item => new { item.ObjectKey, item.ContentType, item.Size })
            .FirstOrDefaultAsync(cancellationToken);
        if (track is null || string.IsNullOrWhiteSpace(track.ObjectKey)) return NotFound();

        var rangeHeader = Request.Headers.Range.ToString();
        var hasRange = !string.IsNullOrWhiteSpace(rangeHeader);
        long start = 0;
        var end = track.Size - 1;
        if (hasRange && !TryParseRange(rangeHeader, track.Size, out start, out end))
        {
            Response.Headers.ContentRange = $"bytes */{track.Size}";
            return StatusCode(StatusCodes.Status416RangeNotSatisfiable);
        }

        try
        {
            var storedObject = await storage.DownloadAsync(
                track.ObjectKey,
                cancellationToken,
                hasRange ? start : null,
                hasRange ? end : null);
            HttpContext.Response.RegisterForDispose(storedObject);
            Response.Headers.AcceptRanges = "bytes";
            Response.ContentLength = hasRange ? end - start + 1 : track.Size;
            if (hasRange)
            {
                Response.Headers.ContentRange = $"bytes {start}-{end}/{track.Size}";
                Response.StatusCode = StatusCodes.Status206PartialContent;
            }

            return File(storedObject.ResponseStream, storedObject.Headers.ContentType ?? track.ContentType);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return NotFound();
        }
    }

    private static bool TryParseRange(string header, long size, out long start, out long end)
    {
        start = 0;
        end = size - 1;
        if (size <= 0 || !header.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)) return false;

        var parts = header[6..].Split('-', 2);
        if (parts.Length != 2 || header.Contains(',')) return false;
        if (string.IsNullOrWhiteSpace(parts[0]))
        {
            if (!long.TryParse(parts[1], out var suffixLength) || suffixLength <= 0) return false;
            start = Math.Max(0, size - suffixLength);
            return true;
        }

        if (!long.TryParse(parts[0], out start) || start < 0 || start >= size) return false;
        if (!string.IsNullOrWhiteSpace(parts[1]) &&
            (!long.TryParse(parts[1], out end) || end < start)) return false;
        end = Math.Min(end, size - 1);
        return true;
    }

    private async Task<IActionResult> GetStoredFile(
        string? objectKey,
        CancellationToken cancellationToken,
        string contentType = "application/octet-stream")
    {
        if (string.IsNullOrWhiteSpace(objectKey)) return NotFound();
        try
        {
            var storedObject = await storage.DownloadAsync(objectKey, cancellationToken);
            HttpContext.Response.RegisterForDispose(storedObject);
            return File(storedObject.ResponseStream, storedObject.Headers.ContentType ?? contentType);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return NotFound();
        }
    }

    private bool CanManageAlbum(Album album) =>
        User.IsInRole("Admin") || User.IsInRole("Moderator") ||
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) && album.OwnerId == userId;

    private static object ToResponse(Album album, bool includeTrackLyrics = true, bool canEdit = false) => new
    {
        id = album.Id,
        name = album.Name,
        artist = album.Artist,
        genre = album.Genre,
        year = album.Year,
        coverUrl = album.CoverObjectKey is null ? null : $"/api/albums/{album.Id}/cover",
        trackCount = album.Tracks.Count,
        canEdit,
        tracks = album.Tracks.OrderBy(track => track.Order)
            .Select(track => ToTrackResponse(track, includeTrackLyrics))
    };

    private static object ToTrackResponse(AlbumTrack track, bool includeLyrics)
    {
        var response = new Dictionary<string, object?>
        {
            ["id"] = track.Id,
            ["title"] = track.Title,
            ["artist"] = track.Artist,
            ["url"] = $"/api/tracks/{track.Id}/file",
            ["order"] = track.Order,
            ["size"] = track.Size,
            ["duration"] = track.Duration,
            ["playCount"] = track.PlayCount
        };
        if (includeLyrics)
        {
            response["lyricsLrc"] = track.LyricsLrc;
            response["lyricsTtml"] = track.LyricsTtml;
        }

        return response;
    }
}

public sealed class CreateAlbumRequest
{
    public string Name { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public string? Genre { get; set; }
    public int? Year { get; set; }
    public IFormFile? Cover { get; set; }
    public List<IFormFile> Tracks { get; set; } = [];
    public string? TrackTitles { get; set; }
    public string? TrackArtists { get; set; }
    public string? TrackDurations { get; set; }
    public string? TrackOrders { get; set; }
    public string? TrackLyricsLrc { get; set; }
    public string? TrackLyricsTtml { get; set; }
}

public sealed class UpdateAlbumRequest
{
    public string Name { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public string? Genre { get; set; }
    public int? Year { get; set; }
    public IFormFile? Cover { get; set; }
    public List<IFormFile> TrackFiles { get; set; } = [];
    public string? TrackMetadata { get; set; }
    public string? TrackFileTrackIndexes { get; set; }
}

public sealed class UpdateAlbumTrackMetadata
{
    public string? Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Artist { get; set; }
    public int Order { get; set; }
    public double? Duration { get; set; }
    public string? LyricsLrc { get; set; }
    public string? LyricsTtml { get; set; }
}