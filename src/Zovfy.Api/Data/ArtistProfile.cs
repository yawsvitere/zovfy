namespace Zovfy.Api.Data;

public sealed class ArtistProfile
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string NameKey { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? BannerObjectKey { get; set; }
    public string? AvatarObjectKey { get; set; }
}
