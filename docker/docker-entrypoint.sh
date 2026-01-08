#!/bin/bash
set -e

echo "Starting Tesla Cloud Web Application..."

# Create necessary directories
mkdir -p /var/run /var/log

# Start PHP-FPM in foreground mode in the background
echo "Starting PHP-FPM..."
php-fpm -F &
PHP_FPM_PID=$!

# Wait for PHP-FPM to be ready
echo "Waiting for PHP-FPM to start..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    # Check if PHP-FPM is listening on port 9000
    if nc -z 127.0.0.1 9000 2>/dev/null; then
        echo "✓ PHP-FPM is ready"
        break
    fi
    
    # Check if PHP-FPM process is still running
    if ! kill -0 $PHP_FPM_PID 2>/dev/null; then
        echo "ERROR: PHP-FPM process died"
        exit 1
    fi
    
    sleep 1
    attempt=$((attempt + 1))
done

# Final check
if ! nc -z 127.0.0.1 9000 2>/dev/null; then
    echo "ERROR: PHP-FPM not listening on port 9000"
    exit 1
fi

# Start nginx in foreground
echo "Starting nginx..."
exec "$@"
