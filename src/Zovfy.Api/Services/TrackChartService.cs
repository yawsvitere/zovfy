using Microsoft.EntityFrameworkCore;
using Zovfy.Api.Data;

namespace Zovfy.Api.Services;

public sealed class TrackChartService(AppDbContext database)
{
    public async Task RefreshAsync(CancellationToken cancellationToken)
    {
        var calculatedAt = DateTimeOffset.UtcNow;
        var windowStart = calculatedAt.AddDays(-7);
        var counts = await database.ListeningEvents
            .Where(item => item.PlayedAt >= windowStart)
            .GroupBy(item => item.TrackId)
            .Select(group => new { TrackId = group.Key, PlayCount = group.LongCount() })
            .OrderByDescending(item => item.PlayCount)
            .ThenBy(item => item.TrackId)
            .Take(100)
            .ToListAsync(cancellationToken);

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.TrackChart.ExecuteDeleteAsync(cancellationToken);
        database.TrackChart.AddRange(counts.Select((item, index) => new TrackChartEntry
        {
            Id = Guid.NewGuid(),
            TrackId = item.TrackId,
            Rank = index + 1,
            PlayCount = item.PlayCount,
            WindowStart = windowStart,
            CalculatedAt = calculatedAt
        }));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}

public sealed class TrackChartRefreshService(
    IServiceScopeFactory scopeFactory,
    ILogger<TrackChartRefreshService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var chart = scope.ServiceProvider.GetRequiredService<TrackChartService>();
                await chart.RefreshAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Failed to refresh the weekly track chart.");
            }

            var now = DateTimeOffset.UtcNow;
            var daysUntilMonday = ((int)DayOfWeek.Monday - (int)now.DayOfWeek + 7) % 7;
            if (daysUntilMonday == 0) daysUntilMonday = 7;
            var nextRefresh = new DateTimeOffset(
                now.UtcDateTime.Date.AddDays(daysUntilMonday),
                TimeSpan.Zero);
            try
            {
                await Task.Delay(nextRefresh - now, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }
}
