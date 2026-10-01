using Microsoft.AspNetCore.Identity;

namespace Zovfy.Api.Data;

public sealed class AppUser : IdentityUser<Guid>
{
	public string? AvatarObjectKey { get; set; }
	public string? BannerObjectKey { get; set; }
	public string? Description { get; set; }
}