using Amazon.S3;
using Amazon.S3.Model;

namespace Zovfy.Api.Services;

public sealed class ObjectStorageService(IAmazonS3 client, IConfiguration configuration)
{
    private readonly string _bucket = configuration["Storage:Bucket"] ?? "zovfy-files";

    public async Task<string> UploadAsync(
        Stream content,
        string fileName,
        string contentType,
        CancellationToken cancellationToken)
    {
        var objectKey = $"{Guid.NewGuid():N}/{fileName}";
        try
        {
            await client.GetBucketLocationAsync(_bucket, cancellationToken);
        }
        catch (AmazonS3Exception exception) when (
            exception.StatusCode == System.Net.HttpStatusCode.NotFound ||
            exception.ErrorCode == "NoSuchBucket")
        {
            await client.PutBucketAsync(new PutBucketRequest { BucketName = _bucket }, cancellationToken);
        }

        await client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _bucket,
            Key = objectKey,
            InputStream = content,
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType
        }, cancellationToken);

        return objectKey;
    }

    public Task<GetObjectResponse> DownloadAsync(
        string objectKey,
        CancellationToken cancellationToken,
        long? rangeStart = null,
        long? rangeEnd = null)
    {
        var request = new GetObjectRequest { BucketName = _bucket, Key = objectKey };
        if (rangeStart.HasValue && rangeEnd.HasValue)
        {
            request.ByteRange = new ByteRange(rangeStart.Value, rangeEnd.Value);
        }

        return client.GetObjectAsync(request, cancellationToken);
    }
}