# Containerized Deployment Guide

Tesla Cloud can be deployed as a Docker container for reliable PHP execution and easy geographic distribution. This containerization makes it suitable for deployment on platforms like Digital Ocean Apps, Kubernetes, and other container orchestration systems.

## Quick Start

### Using Docker Compose (Recommended for Development)

```bash
# Clone the repository
git clone https://github.com/jonbirge/tesla-cloud.git
cd tesla-cloud

# Start the application
docker compose up -d

# Access the application
open http://localhost:8000
```

### Using Docker (Production)

```bash
# Build the image
docker build -t tesla-cloud .

# Run the container
docker run -d \
  --name tesla-cloud \
  -p 8000:8000 \
  -v tesla-cloud-data:/tmp/tesla-cloud \
  tesla-cloud

# Access the application
open http://localhost:8000
```

## Container Architecture

This container includes:
- **PHP 8.2+** with built-in web server
- **SQLite** for data persistence 
- **All application files** (HTML, CSS, JavaScript, PHP)
- **Non-root user** for security
- **Health checks** for monitoring

## Data Persistence

The container uses a mounted volume at `/tmp/tesla-cloud` for SQLite database storage, ensuring data persists between container restarts.

### Docker Compose
Data is automatically persisted using the `tesla-cloud-data` named volume.

### Docker Run
Mount a volume or bind mount for data persistence:
```bash
# Named volume (recommended)
docker run -v tesla-cloud-data:/tmp/tesla-cloud tesla-cloud

# Bind mount
docker run -v ./data:/tmp/tesla-cloud tesla-cloud
```

## Production Deployment

### Environment Variables

The container supports these environment variables:
- `PHP_DISPLAY_ERRORS`: Set to `Off` in production (default)
- `PHP_LOG_ERRORS`: Set to `On` for logging (default)

### Resource Requirements

**Minimum:**
- CPU: 0.1 cores
- Memory: 64MB
- Storage: 100MB

**Recommended:**
- CPU: 0.5 cores  
- Memory: 128MB
- Storage: 500MB

### Health Checks

The container includes built-in health checks that verify:
- PHP server is running
- Application endpoints are responding
- No critical errors in logs

Health check endpoint: `http://localhost:8000/php/vers.php`

## Platform-Specific Deployments

### Digital Ocean Apps

Create an app specification:

```yaml
name: tesla-cloud
services:
- name: web
  source_dir: /
  github:
    repo: jonbirge/tesla-cloud
    branch: main
  run_command: php -S 0.0.0.0:8000
  environment_slug: php
  instance_count: 1
  instance_size_slug: basic-xxs
  http_port: 8000
  routes:
  - path: /
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tesla-cloud
spec:
  replicas: 2
  selector:
    matchLabels:
      app: tesla-cloud
  template:
    metadata:
      labels:
        app: tesla-cloud
    spec:
      containers:
      - name: tesla-cloud
        image: tesla-cloud:latest
        ports:
        - containerPort: 8000
        volumeMounts:
        - name: data
          mountPath: /tmp/tesla-cloud
        resources:
          requests:
            memory: "64Mi"
            cpu: "100m"
          limits:
            memory: "128Mi"
            cpu: "500m"
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: tesla-cloud-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: tesla-cloud-service
spec:
  selector:
    app: tesla-cloud
  ports:
  - port: 80
    targetPort: 8000
  type: LoadBalancer
```

### Docker Swarm

```bash
# Create a stack
docker stack deploy -c docker-compose.yml tesla-cloud
```

## Development

### Building Locally

```bash
# Build the image
docker build -t tesla-cloud:dev .

# Run development container with live reload
docker run -it --rm \
  -p 8000:8000 \
  -v $(pwd):/var/www/html \
  tesla-cloud:dev
```

### Testing

The container includes all test scripts:

```bash
# Run API tests in container
docker exec tesla-cloud-container /var/www/html/test/restdb.sh

# Run environment tests in container  
docker exec tesla-cloud-container bash -c \
  "cd /var/www/html/test && DOTENV_PATH=\"\$(pwd)/../php/dotenv.php\" bash dotenv.sh"
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs tesla-cloud

# Check if port is available
lsof -i :8000
```

### Application not accessible
```bash
# Verify container is running
docker ps

# Test health check
curl http://localhost:8000/php/vers.php
```

### Data not persisting
```bash
# Check volume mounts
docker inspect tesla-cloud

# Verify volume exists
docker volume ls
```

## Security Considerations

- Container runs as non-root user (`www-data`)
- Only necessary ports are exposed (8000)
- No unnecessary packages installed
- Regular security updates via base image updates
- SQLite database is isolated within container

## Monitoring

The application provides these endpoints for monitoring:
- `/php/vers.php` - Version and git information
- `/php/ping.php` - Simple ping endpoint
- Container health checks run automatically

For production monitoring, consider:
- Log aggregation (stdout/stderr)
- Metrics collection (CPU, memory, requests)
- Alert on health check failures
- Regular container image updates