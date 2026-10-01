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

        return Ok(albums.Select(ToResponse));
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
            : Ok(new { album = ToResponse(album), tracks = album.Tracks.OrderBy(track => track.Order).Select(ToTrackResponse) });
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
        try
        {
            titles = JsonSerializer.Deserialize<string[]>(request.TrackTitles ?? "[]") ?? [];
            trackArtists = JsonSerializer.Deserialize<string[]>(request.TrackArtists ?? "[]") ?? [];
            orders = JsonSerializer.Deserialize<int[]>(request.TrackOrders ?? "[]") ?? [];
            durations = JsonSerializer.Deserialize<double?[]>(request.TrackDurations ?? "[]") ?? [];
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "Не удалось прочитать список треков." });
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
                    : null
            });
        }

        database.Albums.Add(album);
        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { ok = true, message = "Альбом создан.", album = ToResponse(album) });
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

    private static object ToResponse(Album album) => new
    {
        id = album.Id,
        name = album.Name,
        artist = album.Artist,
        genre = album.Genre,
        year = album.Year,
        coverUrl = album.CoverObjectKey is null ? null : $"/api/albums/{album.Id}/cover",
        trackCount = album.Tracks.Count,
        tracks = album.Tracks.OrderBy(track => track.Order).Select(ToTrackResponse)
    };

    private static object ToTrackResponse(AlbumTrack track) => new
    {
        id = track.Id,
        title = track.Title,
        artist = track.Artist,
        url = $"/api/tracks/{track.Id}/file",
        order = track.Order,
        size = track.Size,
        duration = track.Duration
    };
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
}