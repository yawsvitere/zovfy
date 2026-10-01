using Amazon.S3;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Zovfy.Api.Data;
using Zovfy.Api.Services;

namespace Zovfy.Api.Controllers;

[ApiController]
[Route("api/artists")]
public sealed class ArtistsController(AppDbContext database, ObjectStorageService storage) : ControllerBase
{
    private const long MaxImageSize = 10 * 1024 * 1024;
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".webp"
    };

    [HttpGet("{name}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetArtist(string name, CancellationToken cancellationToken)
    {
        var key = Normalize(name);
        var profile = await database.ArtistProfiles.AsNoTracking()
            .FirstOrDefaultAsync(item => item.NameKey == key, cancellationToken);
        var releases = await database.Albums.AsNoTracking()
            .Where(album => album.Artist.ToLower() == key ||
                album.Tracks.Any(track => track.Artist.ToLower() == key))
            .OrderByDescending(album => album.Year)
            .ThenByDescending(album => album.CreatedAt)
            .Select(album => new
            {
                id = album.Id,
                name = album.Name,
                artist = album.Artist,
                year = album.Year,
                genre = album.Genre,
                coverUrl = album.CoverObjectKey == null ? null : $"/api/albums/{album.Id}/cover",
                trackCount = album.Tracks.Count
            })
            .ToListAsync(cancellationToken);
        var totalPlays = await database.AlbumTracks.AsNoTracking()
            .Where(track => track.Artist.ToLower() == key || track.Album.Artist.ToLower() == key)
            .SumAsync(track => (long?)track.PlayCount, cancellationToken) ?? 0;

        return Ok(new
        {
            name = profile?.Name ?? releases.FirstOrDefault()?.artist ?? name,
            description = profile?.Description,
            bannerUrl = profile?.BannerObjectKey == null ? null : $"/api/artists/{Uri.EscapeDataString(name)}/banner",
            avatarUrl = profile?.AvatarObjectKey == null ? null : $"/api/artists/{Uri.EscapeDataString(name)}/avatar",
            totalPlays,
            releases
        });
    }

    [HttpPut("{name}")]
    [Authorize(Roles = "Admin,Moderator")]
    [RequestSizeLimit(25_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 25_000_000)]
    public async Task<IActionResult> UpdateArtist(
        string name,
        [FromForm] UpdateArtistRequest request,
        CancellationToken cancellationToken)
    {
        var displayName = name.Trim();
        if (displayName.Length is 0 or > 120 || request.Description?.Length > 5000)
        {
            return BadRequest(new { message = "Проверьте название артиста и описание (не более 5000 символов)." });
        }
        if (!IsValidImage(request.Avatar) || !IsValidImage(request.Banner))
        {
            return BadRequest(new { message = "Изображения должны быть JPG, PNG или WEBP и не больше 10 МБ." });
        }

        var key = Normalize(displayName);
        var profile = await database.ArtistProfiles.FirstOrDefaultAsync(item => item.NameKey == key, cancellationToken);
        if (profile is null)
        {
            profile = new ArtistProfile { Id = Guid.NewGuid(), Name = displayName, NameKey = key };
            database.ArtistProfiles.Add(profile);
        }
        profile.Name = displayName;
        profile.Description = request.Description?.Trim();
        if (request.Avatar is { Length: > 0 } avatar)
        {
            await using var stream = avatar.OpenReadStream();
            profile.AvatarObjectKey = await storage.UploadAsync(stream, Path.GetFileName(avatar.FileName), avatar.ContentType, cancellationToken);
        }
        if (request.Banner is { Length: > 0 } banner)
        {
            await using var stream = banner.OpenReadStream();
            profile.BannerObjectKey = await storage.UploadAsync(stream, Path.GetFileName(banner.FileName), banner.ContentType, cancellationToken);
        }

        await database.SaveChangesAsync(cancellationToken);
        return Ok(new { ok = true });
    }

    [HttpGet("{name}/avatar")]
    [AllowAnonymous]
    public Task<IActionResult> GetAvatar(string name, CancellationToken cancellationToken) =>
        GetArtistImage(name, banner: false, cancellationToken);

    [HttpGet("{name}/banner")]
    [AllowAnonymous]
    public Task<IActionResult> GetBanner(string name, CancellationToken cancellationToken) =>
        GetArtistImage(name, banner: true, cancellationToken);

    private async Task<IActionResult> GetArtistImage(string name, bool banner, CancellationToken cancellationToken)
    {
        var key = Normalize(name);
        var objectKey = await database.ArtistProfiles
            .Where(item => item.NameKey == key)
            .Select(item => banner ? item.BannerObjectKey : item.AvatarObjectKey)
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

    private static string Normalize(string name) => name.Trim().ToLowerInvariant();

    private static bool IsValidImage(IFormFile? file) =>
        file is null || file.Length == 0 ||
        file.Length <= MaxImageSize && ImageExtensions.Contains(Path.GetExtension(file.FileName));
}

public sealed class UpdateArtistRequest
{
    public string? Description { get; set; }
    public IFormFile? Avatar { get; set; }
    public IFormFile? Banner { get; set; }
}
