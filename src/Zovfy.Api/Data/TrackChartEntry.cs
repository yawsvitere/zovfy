namespace Zovfy.Api.Data;

public sealed class TrackChartEntry
{
    public Guid Id { get; set; }
    public Guid TrackId { get; set; }
    public AlbumTrack Track { get; set; } = null!;
    public int Rank { get; set; }
    public long PlayCount { get; set; }
    public DateTimeOffset WindowStart { get; set; }
    public DateTimeOffset CalculatedAt { get; set; }
}
