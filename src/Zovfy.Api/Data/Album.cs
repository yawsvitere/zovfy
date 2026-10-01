namespace Zovfy.Api.Data;

public sealed class Album
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public int? Year { get; set; }
    public string? CoverObjectKey { get; set; }
    public Guid OwnerId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public ICollection<AlbumTrack> Tracks { get; set; } = new List<AlbumTrack>();
}