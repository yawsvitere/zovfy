using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Zovfy.Api.Services;

namespace Zovfy.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/files")]
public sealed class FilesController(ObjectStorageService storage) : ControllerBase
{
    [HttpPost]
    [RequestSizeLimit(50_000_000)]
    public async Task<IActionResult> Upload(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length == 0)
        {
            return BadRequest(new { message = "Файл пустой." });
        }

        await using var stream = file.OpenReadStream();
        var objectKey = await storage.UploadAsync(
            stream,
            Path.GetFileName(file.FileName),
            file.ContentType,
            cancellationToken);

        return Ok(new { objectKey, fileName = Path.GetFileName(file.FileName), file.Length });
    }
}