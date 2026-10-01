using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Zovfy.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Album> Albums => Set<Album>();
    public DbSet<AlbumTrack> AlbumTracks => Set<AlbumTrack>();
    public DbSet<ListeningEvent> ListeningEvents => Set<ListeningEvent>();
    public DbSet<TrackChartEntry> TrackChart => Set<TrackChartEntry>();
    public DbSet<ArtistProfile> ArtistProfiles => Set<ArtistProfile>();
    public DbSet<UserAlbumLike> UserAlbumLikes => Set<UserAlbumLike>();
    public DbSet<UserTrackLike> UserTrackLikes => Set<UserTrackLike>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ListeningEvent>()
            .HasIndex(item => item.PlaySessionId)
            .IsUnique();
        builder.Entity<ListeningEvent>()
            .HasOne(item => item.User)
            .WithMany()
            .HasForeignKey(item => item.UserId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.Entity<ListeningEvent>()
            .HasIndex(item => new { item.TrackId, item.PlayedAt });

        builder.Entity<TrackChartEntry>()
            .HasIndex(item => item.TrackId)
            .IsUnique();
        builder.Entity<TrackChartEntry>()
            .HasIndex(item => item.Rank)
            .IsUnique();

        builder.Entity<ArtistProfile>()
            .HasIndex(item => item.NameKey)
            .IsUnique();

        builder.Entity<UserAlbumLike>()
            .HasKey(item => new { item.UserId, item.AlbumId });
        builder.Entity<UserTrackLike>()
            .HasKey(item => new { item.UserId, item.TrackId });
    }
}