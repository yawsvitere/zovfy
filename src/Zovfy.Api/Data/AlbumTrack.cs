namespace Zovfy.Api.Data;

public sealed class AlbumTrack
{
    public Guid Id { get; set; }
    public Guid AlbumId { get; set; }
    public Album Album { get; set; } = null!;
    public string Title { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public int Order { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string ObjectKey { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long Size { get; set; }
    public double? Duration { get; set; }
}