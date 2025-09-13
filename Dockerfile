# Multi-stage build for Tesla Cloud containerized deployment
FROM php:8.2-cli-alpine AS base

# Install required extensions for SQLite and general functionality
RUN apk add --no-cache \
    sqlite \
    sqlite-dev \
    && docker-php-ext-install pdo_sqlite

# Set working directory
WORKDIR /var/www/html

# Copy application files
COPY . .

# Create directory for SQLite database with proper permissions
RUN mkdir -p /tmp/tesla-cloud && \
    chown -R www-data:www-data /tmp/tesla-cloud && \
    chown -R www-data:www-data /var/www/html

# Expose port 8000 (matching development setup)
EXPOSE 8000

# Switch to non-root user for security
USER www-data

# Health check to ensure application is running
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD php -r "if(@file_get_contents('http://localhost:8000/php/vers.php')===false) exit(1);"

# Start PHP built-in server (matches development setup)
CMD ["php", "-S", "0.0.0.0:8000"]