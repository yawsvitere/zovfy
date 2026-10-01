FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY src/Zovfy.Api/Zovfy.Api.csproj src/Zovfy.Api/
RUN dotnet restore src/Zovfy.Api/Zovfy.Api.csproj
COPY src/Zovfy.Api/ src/Zovfy.Api/
RUN dotnet publish src/Zovfy.Api/Zovfy.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Zovfy.Api.dll"]