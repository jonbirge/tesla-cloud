# tesla-cloud

## About

JavaScript-based site with information and links intended for use on an in-car browser. Currently focused on Teslas, but could be adapted for other vehicles with a browser.

## Demo

The main branch is generally running at <https://dev.teslas.cloud>.

## Docker Deployment

Tesla Cloud can be deployed using Docker containers with nginx, PHP-FPM, MySQL, and Traefik reverse proxy. See [DOCKER.md](DOCKER.md) for detailed deployment instructions.

Quick start:
```bash
cp .env.docker.example .env
# Edit .env with your configuration
make build
make up
```

## Contributing

If you're interested in helping develop this further, contact <feedback@teslas.cloud>.
