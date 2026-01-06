# Tesla Cloud Web Application Dockerfile
# Based on nginx with PHP-FPM

FROM php:8.2-fpm

# Install system dependencies and nginx
RUN apt-get update && apt-get install -y \
    nginx \
    git \
    unzip \
    libzip-dev \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    libonig-dev \
    libxml2-dev \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Install PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    pdo \
    pdo_mysql \
    mysqli \
    mbstring \
    zip \
    gd \
    opcache

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configure PHP-FPM to use TCP socket (more reliable in containers)
RUN mkdir -p /var/run /var/log && \
    sed -i 's/listen = 127.0.0.1:9000/listen = 127.0.0.1:9000/' /usr/local/etc/php-fpm.d/www.conf

# Configure nginx
RUN rm -f /etc/nginx/sites-enabled/default
COPY config/nginx.conf /etc/nginx/sites-available/tesla-cloud
RUN ln -s /etc/nginx/sites-available/tesla-cloud /etc/nginx/sites-enabled/tesla-cloud \
    && mkdir -p /var/www/html

# Copy application files
COPY --chown=www-data:www-data . /var/www/html/

# Install PHP dependencies for share.php (Brevo API)
WORKDIR /var/www/html
RUN if [ -f composer.json ]; then \
    composer install --no-dev --optimize-autoloader; \
    fi

# Create necessary directories
RUN mkdir -p /var/www/html/tmp \
    && chown -R www-data:www-data /var/www/html

# Expose port 8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# Start script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
