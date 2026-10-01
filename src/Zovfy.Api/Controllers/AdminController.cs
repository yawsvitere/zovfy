using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Zovfy.Api.Data;

namespace Zovfy.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles = "Admin")]
public sealed class AdminController(
    UserManager<AppUser> userManager,
    IConfiguration configuration) : ControllerBase
{
    private static readonly string[] AssignableRoles = ["User", "Moderator", "Admin"];

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        var users = await userManager.Users.AsNoTracking().OrderBy(user => user.Email).ToListAsync();
        var result = new List<object>(users.Count);
        foreach (var user in users)
        {
            result.Add(new
            {
                id = user.Id,
                email = user.Email,
                description = user.Description,
                roles = await userManager.GetRolesAsync(user)
            });
        }

        return Ok(result);
    }

    [HttpPut("users/{id:guid}/role")]
    public async Task<IActionResult> SetRole(Guid id, SetUserRoleRequest request)
    {
        if (!AssignableRoles.Contains(request.Role, StringComparer.Ordinal))
        {
            return BadRequest(new { message = "Допустимые роли: User, Moderator и Admin." });
        }

        var user = await userManager.FindByIdAsync(id.ToString());
        if (user is null) return NotFound(new { message = "Пользователь не найден." });
        var currentRoles = await userManager.GetRolesAsync(user);
        var initialAdminEmail = configuration["ADMIN_EMAIL"];
        if (currentRoles.Contains("Admin") && request.Role != "Admin")
        {
            var adminCount = await userManager.GetUsersInRoleAsync("Admin");
            if (adminCount.Count <= 1 || string.Equals(user.Email, initialAdminEmail, StringComparison.OrdinalIgnoreCase))
            {
                return Conflict(new { message = "Нельзя снять роль с единственного или начального администратора." });
            }
        }

        var removeResult = await userManager.RemoveFromRolesAsync(user, currentRoles);
        if (!removeResult.Succeeded) return BadRequest(new { errors = removeResult.Errors.Select(error => error.Description) });
        var addResult = await userManager.AddToRoleAsync(user, request.Role);
        if (!addResult.Succeeded) return BadRequest(new { errors = addResult.Errors.Select(error => error.Description) });
        return NoContent();
    }
}

public sealed record SetUserRoleRequest(string Role);
