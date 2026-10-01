using System.Text;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Zovfy.Api.Data;
using Zovfy.Api.Hubs;
using Zovfy.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services
    .AddIdentityCore<AppUser>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 8;
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddSignInManager();

var jwtKey = builder.Configuration["Jwt:Key"]!;
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = token;
                }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()));
builder.Services.AddSingleton<IAmazonS3>(_ =>
{
    var storage = builder.Configuration.GetSection("Storage");
    var clientConfig = new AmazonS3Config
    {
        ServiceURL = storage["Endpoint"],
        ForcePathStyle = true
    };
    var credentials = new BasicAWSCredentials(storage["AccessKey"], storage["SecretKey"]);
    return new AmazonS3Client(credentials, clientConfig);
});
builder.Services.AddScoped<ObjectStorageService>();
builder.Services.AddScoped<TrackChartService>();
builder.Services.AddHostedService<TrackChartRefreshService>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "Zovfy API", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme
        {
            Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
        }] = Array.Empty<string>()
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "zovfy-api",
    timestamp = DateTimeOffset.UtcNow
})).AllowAnonymous();
app.MapControllers();
app.MapHub<UpdatesHub>("/hubs/updates").RequireAuthorization();

await using (var scope = app.Services.CreateAsyncScope())
{
    var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await database.Database.EnsureCreatedAsync();
    await database.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "Albums" (
            "Id" uuid PRIMARY KEY,
            "Name" text NOT NULL,
            "Artist" text NOT NULL,
            "Genre" text NULL,
            "Year" integer NULL,
            "CoverObjectKey" text NULL,
            "OwnerId" uuid NOT NULL,
            "CreatedAt" timestamp with time zone NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "AlbumTracks" (
            "Id" uuid PRIMARY KEY,
            "AlbumId" uuid NOT NULL REFERENCES "Albums" ("Id") ON DELETE CASCADE,
            "Title" text NOT NULL,
            "Artist" text NOT NULL,
            "Order" integer NOT NULL,
            "FileName" text NOT NULL,
            "ObjectKey" text NOT NULL,
            "ContentType" text NOT NULL,
            "Size" bigint NOT NULL,
            "Duration" double precision NULL
        );
        ALTER TABLE "AlbumTracks" ADD COLUMN IF NOT EXISTS "LyricsLrc" text NULL;
        ALTER TABLE "AlbumTracks" ADD COLUMN IF NOT EXISTS "LyricsTtml" text NULL;
        ALTER TABLE "AlbumTracks" ADD COLUMN IF NOT EXISTS "PlayCount" bigint NOT NULL DEFAULT 0;
        ALTER TABLE "Albums" ADD COLUMN IF NOT EXISTS "Genre" text NULL;
        ALTER TABLE "AlbumTracks" ADD COLUMN IF NOT EXISTS "Duration" double precision NULL;
        CREATE INDEX IF NOT EXISTS "IX_AlbumTracks_AlbumId" ON "AlbumTracks" ("AlbumId");
        ALTER TABLE "AspNetUsers" ADD COLUMN IF NOT EXISTS "AvatarObjectKey" text NULL;
        ALTER TABLE "AspNetUsers" ADD COLUMN IF NOT EXISTS "BannerObjectKey" text NULL;
        ALTER TABLE "AspNetUsers" ADD COLUMN IF NOT EXISTS "Description" text NULL;
        CREATE TABLE IF NOT EXISTS "ListeningEvents" (
            "Id" uuid PRIMARY KEY,
            "PlaySessionId" uuid NOT NULL UNIQUE,
            "TrackId" uuid NOT NULL REFERENCES "AlbumTracks" ("Id") ON DELETE CASCADE,
            "UserId" uuid NULL REFERENCES "AspNetUsers" ("Id") ON DELETE SET NULL,
            "PlayedAt" timestamp with time zone NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "IX_ListeningEvents_TrackId_PlayedAt" ON "ListeningEvents" ("TrackId", "PlayedAt");
        CREATE TABLE IF NOT EXISTS "TrackChart" (
            "Id" uuid PRIMARY KEY,
            "TrackId" uuid NOT NULL UNIQUE REFERENCES "AlbumTracks" ("Id") ON DELETE CASCADE,
            "Rank" integer NOT NULL UNIQUE,
            "PlayCount" bigint NOT NULL,
            "WindowStart" timestamp with time zone NOT NULL,
            "CalculatedAt" timestamp with time zone NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "ArtistProfiles" (
            "Id" uuid PRIMARY KEY,
            "Name" text NOT NULL,
            "NameKey" text NOT NULL UNIQUE,
            "Description" text NULL,
            "BannerObjectKey" text NULL,
            "AvatarObjectKey" text NULL
        );
        CREATE TABLE IF NOT EXISTS "UserAlbumLikes" (
            "UserId" uuid NOT NULL REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE,
            "AlbumId" uuid NOT NULL REFERENCES "Albums" ("Id") ON DELETE CASCADE,
            "CreatedAt" timestamp with time zone NOT NULL,
            PRIMARY KEY ("UserId", "AlbumId")
        );
        CREATE TABLE IF NOT EXISTS "UserTrackLikes" (
            "UserId" uuid NOT NULL REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE,
            "TrackId" uuid NOT NULL REFERENCES "AlbumTracks" ("Id") ON DELETE CASCADE,
            "CreatedAt" timestamp with time zone NOT NULL,
            PRIMARY KEY ("UserId", "TrackId")
        );
        """);

    var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
    foreach (var roleName in new[] { "Admin", "Moderator", "User" })
    {
        if (!await roleManager.RoleExistsAsync(roleName))
        {
            await roleManager.CreateAsync(new IdentityRole<Guid>(roleName));
        }
    }
}

await app.RunAsync();