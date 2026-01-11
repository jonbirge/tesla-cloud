# Tesla Cloud - Docker Deployment Guide

This guide explains how to deploy Tesla Cloud using Docker containers.

## Architecture

The Docker deployment consists of three services:

1. **tesla-cloud**: The main web application (nginx + PHP-FPM)
2. **db**: MySQL 8.0 database server
3. **traefik**: Reverse proxy with automatic HTTPS (Let's Encrypt)

## Quick Start

### Prerequisites

- Docker (20.10+)
- Docker Compose (2.0+)
- Make (optional, for using Makefile commands)

### Basic Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jonbirge/tesla-cloud.git
   cd tesla-cloud/docker
   ```

2. **Create environment configuration**:
   ```bash
   cp .env.docker.example .env
   ```

3. **Edit `.env` file** with your configuration:
   - Set `DOMAIN` to your actual domain name
   - Set `MYSQL_ROOT_PASSWORD` and `MYSQL_PASSWORD` to secure, unique values
   - Add API keys (optional): `OPENWX_KEY`, `BREVO_KEY`, `FINNHUB_KEY`
   - Update `ACME_EMAIL` for Let's Encrypt notifications
   - Generate and set `TRAEFIK_AUTH` for Traefik dashboard access:
     ```bash
     htpasswd -nb admin your_secure_password
     ```
   - **Important**: In the `.env` file, escape dollar signs with double `$$`:
     ```
     TRAEFIK_AUTH=admin:$$apr1$$xyz...
     ```

4. **Build the Docker image**:
   ```bash
   make build
   ```
   Or without Make:
   ```bash
   docker build -f Dockerfile -t tesla-cloud:latest ..
   ```

5. **Start the application**:
   ```bash
   make up
   ```
   Or without Make:
   ```bash
   docker compose up -d
   ```

6. **Access the application**:
   - HTTP: `http://localhost` (redirects to HTTPS)
   - HTTPS: `https://your-domain.com` (after DNS is configured)
   - Traefik Dashboard: `http://traefik.your-domain.com` (optional)

## Environment Variables

The application supports both JSON `.env` files and actual environment variables. In Docker deployments, environment variables are set in `docker-compose.yml` and take precedence over the JSON file.

### Required Variables (for full functionality)

- `SQL_HOST`: MySQL host (set to `db` in docker-compose)
- `SQL_PORT`: MySQL port (default: 3306)
- `SQL_DB_NAME`: Database name
- `SQL_USER`: Database user
- `SQL_PASS`: Database password

### Optional Variables

- `OPENWX_KEY`: OpenWeatherMap API key for weather data
- `BREVO_KEY`: Brevo API key for email sharing functionality
- `FINNHUB_KEY`: Finnhub API key for stock quotes
- `SQLITE_PATH`: Path to SQLite database (fallback when MySQL not available)

## Makefile Commands

The included Makefile provides convenient commands:

```bash
make help          # Show all available commands
make build         # Build the Docker image
make up            # Start the application stack
make down          # Stop the application stack
make restart       # Restart the application
make logs          # Show logs from all services
make logs-app      # Show logs from tesla-cloud service
make logs-db       # Show logs from database service
make logs-traefik  # Show logs from Traefik service
make clean         # Remove containers, volumes, and images
make rebuild       # Clean and rebuild
make test          # Run application tests
make dev           # Start local development server (non-Docker)
make shell         # Open bash in the tesla-cloud container
make db-shell      # Open MySQL shell in database container
make status        # Show status of all services
```

## Production Deployment

### DNS Configuration

Point your domain to the server's IP address:
```
A    @              <your-server-ip>
A    www            <your-server-ip>
A    traefik        <your-server-ip>  # Optional, for dashboard
```

### Security Recommendations

1. **Change default passwords** in `.env`:
   - `MYSQL_ROOT_PASSWORD`
   - `MYSQL_PASSWORD`
   - `TRAEFIK_AUTH`

2. **Generate secure Traefik auth** credentials:
   ```bash
   htpasswd -nb admin your_secure_password
   ```
   Add the output to `TRAEFIK_AUTH` in `.env`

3. **Disable Traefik dashboard** in production (optional):
   Edit `docker-compose.yml` and remove the dashboard-related labels and port 8080

4. **Use firewall rules** to restrict access:
   - Allow ports: 80 (HTTP), 443 (HTTPS)
   - Block direct access to: 3306 (MySQL), 8080 (Traefik dashboard)

5. **Regular backups** of MySQL data:
   ```bash
   docker-compose exec db mysqldump -u teslacloud -p teslacloud > backup.sql
   ```

### Monitoring

View logs for troubleshooting:
```bash
# All services
make logs

# Individual services
make logs-app
make logs-db
make logs-traefik

# Follow logs in real-time
docker compose logs -f tesla-cloud
```

Check service health:
```bash
make status
docker compose ps
```

## Development

For local development without Docker:

1. **Install PHP 8.2+** with required extensions
2. **Start development server** (from repository root):
   ```bash
   cd ..
   php -S localhost:8000
   # Or from docker directory: make dev
   ```
3. **Run tests**:
   ```bash
   make test
   ```

## Database Management

### Access MySQL shell
```bash
make db-shell
# Or: docker compose exec db mysql -u teslacloud -p teslacloud
```

### Backup database
```bash
docker compose exec db mysqldump -u teslacloud -p teslacloud > backup-$(date +%Y%m%d).sql
```

### Restore database
```bash
docker compose exec -T db mysql -u teslacloud -p teslacloud < backup.sql
```

### Reset database
```bash
make down
docker volume rm tesla-cloud_mysql-data
make up
```

## Troubleshooting

### Application not accessible
1. Check if containers are running: `make status`
2. Check logs: `make logs-app`
3. Verify firewall allows ports 80 and 443
4. Check DNS configuration

### Database connection issues
1. Verify MySQL is running: `make logs-db`
2. Check environment variables in docker-compose.yml
3. Ensure database was initialized properly

### Let's Encrypt certificate issues
1. Verify DNS points to your server
2. Ensure ports 80 and 443 are accessible
3. Check Traefik logs: `make logs-traefik`
4. Verify `ACME_EMAIL` is set correctly

### Permission issues
```bash
# Fix ownership in container
docker-compose exec tesla-cloud chown -R www-data:www-data /var/www/html
```

## Contributing

See the main [README.md](README.md) for contribution guidelines.

## License

See [LICENSE](LICENSE) file for details.
