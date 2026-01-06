#!/bin/bash
set -e

echo "Starting Tesla Cloud Web Application..."

# Start PHP-FPM
echo "Starting PHP-FPM..."
php-fpm -D

# Wait for PHP-FPM to be ready
echo "Waiting for PHP-FPM to be ready..."
for i in {1..10}; do
    if [ -S /var/run/php-fpm.sock ]; then
        echo "PHP-FPM is ready"
        break
    fi
    sleep 1
done

# Test PHP-FPM socket
if [ ! -S /var/run/php-fpm.sock ]; then
    echo "ERROR: PHP-FPM socket not found!"
    exit 1
fi

# Start nginx
echo "Starting nginx..."
exec "$@"
