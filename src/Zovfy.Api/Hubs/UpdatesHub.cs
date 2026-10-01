using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Zovfy.Api.Hubs;

[Authorize]
public sealed class UpdatesHub : Hub
{
}