using System.Security.Claims;
using Amazon.S3;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Zovfy.Api.Data;
using Zovfy.Api.Services;

namespace Zovfy.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/users")]
public sealed class UsersController(
    AppDbContext database,
    UserManager<AppUser> userManager,
    ObjectStorageService storage) : ControllerBase
{
    private const long MaxImageSize = 10 * 1024 * 1024;
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp"
    };

    [HttpGet("me")]
    public async Task<IActionResult> GetMe(CancellationToken cancellationToken)
    {
        var user = await GetCurrentUser(cancellationToken);
        if (user is null) return Unauthorized();
        return Ok(await ToProfile(user));
    }

    [HttpPut("me")]
    [RequestSizeLimit(25_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 25_000_000)]
    public async Task<IActionResult> UpdateMe(
        [FromForm] UpdateUserProfileRequest request,
        CancellationToken cancellationToken)
    {
        var user = await GetCurrentUser(cancellationToken);
        if (user is null) return Unauthorized();
        if (request.Description?.Length > 5000 || !IsValidImage(request.Avatar) || !IsValidImage(request.Banner))
        {
            return BadRequest(new { message = "Описание ограничено 5000 символами, изображения должны быть JPG, PNG или WEBP до 10 МБ." });
        }

        user.Description = request.Description?.Trim();
        if (request.Avatar is { Length: > 0 } avatar)
        {
            await using var stream = avatar.OpenReadStream();
            user.AvatarObjectKey = await storage.UploadAsync(stream, Path.GetFileName(avatar.FileName), avatar.ContentType, cancellationToken);
        }
        if (request.Banner is { Length: > 0 } banner)
        {
            await using var stream = banner.OpenReadStream();
            user.BannerObjectKey = await storage.UploadAsync(stream, Path.GetFileName(banner.FileName), banner.ContentType, cancellationToken);
        }

        await database.SaveChangesAsync(cancellationToken);
        return Ok(await ToProfile(user));
    }

    [HttpGet("me/likes")]
    public async Task<IActionResult> GetLikes(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();
        var albums = await database.UserAlbumLikes.AsNoTracking()
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt)
            .Select(item => new
            {
                id = item.Album.Id,
                name = item.Album.Name,
                artist = item.Album.Artist,
                year = item.Album.Year,
                coverUrl = item.Album.CoverObjectKey == null ? null : $"/api/albums/{item.AlbumId}/cover"
            })
            .ToListAsync(cancellationToken);
        var tracks = await database.UserTrackLikes.AsNoTracking()
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt)
            .Select(item => new
            {
                id = item.Track.Id,
                title = item.Track.Title,
                artist = item.Track.Artist,
                url = $"/api/tracks/{item.TrackId}/file",
                duration = item.Track.Duration,
                coverUrl = item.Track.Album.CoverObjectKey == null ? null : $"/api/albums/{item.Track.AlbumId}/cover"
            })
            .ToListAsync(cancellationToken);
        return Ok(new { albums, tracks });
    }

    [HttpPut("me/likes/albums/{id:guid}")]
    public async Task<IActionResult> LikeAlbum(Guid id, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();
        if (!await database.Albums.AnyAsync(item => item.Id == id, cancellationToken)) return NotFound();
        var createdAt = DateTimeOffset.UtcNow;
        await database.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "UserAlbumLikes" ("UserId", "AlbumId", "CreatedAt")
            VALUES ({userId.Value}, {id}, {createdAt})
            ON CONFLICT ("UserId", "AlbumId") DO NOTHING
            """, cancellationToken);
        return NoContent();
    }

    [HttpDelete("me/likes/albums/{id:guid}")]
    public async Task<IActionResult> UnlikeAlbum(Guid id, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();
        await database.UserAlbumLikes.Where(item => item.UserId == userId && item.AlbumId == id)
            .ExecuteDeleteAsync(cancellationToken);
        return NoContent();
    }

    [HttpPut("me/likes/tracks/{id:guid}")]
    public async Task<IActionResult> LikeTrack(Guid id, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();
        if (!await database.AlbumTracks.AnyAsync(item => item.Id == id, cancellationToken)) return NotFound();
        var createdAt = DateTimeOffset.UtcNow;
        await database.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "UserTrackLikes" ("UserId", "TrackId", "CreatedAt")
            VALUES ({userId.Value}, {id}, {createdAt})
            ON CONFLICT ("UserId", "TrackId") DO NOTHING
            """, cancellationToken);
        return NoContent();
    }

    [HttpDelete("me/likes/tracks/{id:guid}")]
    public async Task<IActionResult> UnlikeTrack(Guid id, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();
        await database.UserTrackLikes.Where(item => item.UserId == userId && item.TrackId == id)
            .ExecuteDeleteAsync(cancellationToken);
        return NoContent();
    }

    [HttpGet("{id:guid}/avatar")]
    [AllowAnonymous]
    public Task<IActionResult> GetAvatar(Guid id, CancellationToken cancellationToken) =>
        GetUserImage(id, banner: false, cancellationToken);

    [HttpGet("{id:guid}/banner")]
    [AllowAnonymous]
    public Task<IActionResult> GetBanner(Guid id, CancellationToken cancellationToken) =>
        GetUserImage(id, banner: true, cancellationToken);

    private async Task<object> ToProfile(AppUser user) => new
    {
        id = user.Id,
        email = user.Email,
        description = user.Description,
        avatarUrl = user.AvatarObjectKey == null ? null : $"/api/users/{user.Id}/avatar",
        bannerUrl = user.BannerObjectKey == null ? null : $"/api/users/{user.Id}/banner",
        roles = await userManager.GetRolesAsync(user)
    };

    private async Task<AppUser?> GetCurrentUser(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        return userId is null ? null : await userManager.FindByIdAsync(userId.Value.ToString());
    }

    private Guid? GetUserId() =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    private async Task<IActionResult> GetUserImage(Guid id, bool banner, CancellationToken cancellationToken)
    {
        var objectKey = await database.Users
            .Where(user => user.Id == id)
            .Select(user => banner ? user.BannerObjectKey : user.AvatarObjectKey)
            .FirstOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(objectKey)) return NotFound();
        try
        {
            var stored = await storage.DownloadAsync(objectKey, cancellationToken);
            HttpContext.Response.RegisterForDispose(stored);
            return File(stored.ResponseStream, stored.Headers.ContentType ?? "application/octet-stream");
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return NotFound();
        }
    }

    private static bool IsValidImage(IFormFile? file) =>
        file is null || file.Length == 0 ||
        file.Length <= MaxImageSize && ImageExtensions.Contains(Path.GetExtension(file.FileName));
}

public sealed class UpdateUserProfileRequest
{
    public string? Description { get; set; }
    public IFormFile? Avatar { get; set; }
    public IFormFile? Banner { get; set; }
}
