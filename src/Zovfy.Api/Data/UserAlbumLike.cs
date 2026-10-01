namespace Zovfy.Api.Data;

public sealed class UserAlbumLike
{
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public Guid AlbumId { get; set; }
    public Album Album { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; }
}
