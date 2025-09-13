# tesla-cloud

## About

JavaScript-based site with information and links intended for use on an in-car browser. Currently focused on Teslas, but could be adapted for other vehicles with a browser.

## Demo

The release branch is generally running at <https://teslas.cloud>.

## Deployment

### Containerized Deployment

Tesla Cloud can be deployed as a Docker container for reliable PHP execution and easy geographic distribution:

```bash
# Quick start with Docker Compose
docker compose up -d

# Or build and run manually
docker build -t tesla-cloud .
docker run -d -p 8000:8000 -v tesla-cloud-data:/tmp/tesla-cloud tesla-cloud
```

See [docs/deployment.md](docs/deployment.md) for complete deployment documentation, including platform-specific instructions for Digital Ocean Apps, Kubernetes, and other container orchestration systems.

### Development

```bash
# Start PHP development server
php -S localhost:8000

# Run tests
./test/restdb.sh
cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh
```

## Contributing

If you're interested in helping develop this further, contact <feedback@teslas.cloud>.
