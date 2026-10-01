using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Zovfy.Api.Data;

namespace Zovfy.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class ListeningController(AppDbContext database) : ControllerBase
{
    [HttpPost("tracks/{id:guid}/listen")]
    [AllowAnonymous]
    public async Task<IActionResult> RecordListen(
        Guid id,
        RecordListeningRequest request,
        CancellationToken cancellationToken)
    {
        if (request.PlaySessionId == Guid.Empty)
        {
            return BadRequest(new { message = "Не указан идентификатор сессии воспроизведения." });
        }

        var trackExists = await database.AlbumTracks.AnyAsync(track => track.Id == id, cancellationToken);
        if (!trackExists) return NotFound(new { message = "Трек не найден." });

        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var parsedUserId)
            ? parsedUserId
            : (Guid?)null;
        var playedAt = DateTimeOffset.UtcNow;

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var inserted = await database.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "ListeningEvents" ("Id", "PlaySessionId", "TrackId", "UserId", "PlayedAt")
            VALUES ({Guid.NewGuid()}, {request.PlaySessionId}, {id}, {userId}, {playedAt})
            ON CONFLICT ("PlaySessionId") DO NOTHING
            """, cancellationToken);

        if (inserted == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Ok(new { counted = false });
        }

        await database.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "AlbumTracks"
            SET "PlayCount" = "PlayCount" + 1
            WHERE "Id" = {id}
            """, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { counted = true });
    }

    [HttpGet("chart")]
    [AllowAnonymous]
    public async Task<IActionResult> GetChart(CancellationToken cancellationToken)
    {
        var entries = await database.TrackChart
            .AsNoTracking()
            .OrderBy(item => item.Rank)
            .Select(item => new
            {
                rank = item.Rank,
                playCount = item.PlayCount,
                windowStart = item.WindowStart,
                calculatedAt = item.CalculatedAt,
                track = new
                {
                    id = item.Track.Id,
                    title = item.Track.Title,
                    artist = item.Track.Artist,
                    url = $"/api/tracks/{item.Track.Id}/file",
                    album = new
                    {
                        id = item.Track.Album.Id,
                        name = item.Track.Album.Name,
                        artist = item.Track.Album.Artist,
                        coverUrl = item.Track.Album.CoverObjectKey == null
                            ? null
                            : $"/api/albums/{item.Track.AlbumId}/cover"
                    }
                }
            })
            .ToListAsync(cancellationToken);

        return Ok(entries);
    }

    [HttpGet("tracks/{id:guid}/lyrics")]
    [AllowAnonymous]
    public async Task<IActionResult> GetLyrics(Guid id, CancellationToken cancellationToken)
    {
        var lyrics = await database.AlbumTracks
            .Where(track => track.Id == id)
            .Select(track => new { track.LyricsLrc, track.LyricsTtml })
            .FirstOrDefaultAsync(cancellationToken);
        return lyrics is null
            ? NotFound(new { message = "Трек не найден." })
            : Ok(new { lrc = lyrics.LyricsLrc, ttml = lyrics.LyricsTtml });
    }
}

public sealed record RecordListeningRequest(Guid PlaySessionId);
