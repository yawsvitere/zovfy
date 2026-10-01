namespace Zovfy.Api.Data;

public sealed class ListeningEvent
{
    public Guid Id { get; set; }
    public Guid PlaySessionId { get; set; }
    public Guid TrackId { get; set; }
    public AlbumTrack Track { get; set; } = null!;
    public Guid? UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTimeOffset PlayedAt { get; set; }
}
