namespace Zovfy.Api.Data;

public sealed class UserTrackLike
{
    public Guid UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public Guid TrackId { get; set; }
    public AlbumTrack Track { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; }
}
