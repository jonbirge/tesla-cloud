#!/bin/bash

# =============================================================================
# Settings Polling Test Suite
# Tests the live updating of settings functionality
# =============================================================================

# Configuration parameters
BASE_URL="${BASE_URL:-http://localhost:8000/php/settings.php}"
VERBOSE=false
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PHP_SERVER_PID=""
STARTED_SERVER=false

# Ensure database tables exist
if [ -f "$ROOT_DIR/utils/setup_tables.py" ]; then
    python3 "$ROOT_DIR/utils/setup_tables.py" > /dev/null 2>&1
fi

echo "🔍 Testing Settings Live Update Functionality..."

# =============================================================================
# Helper Functions
# =============================================================================

# Start a local PHP server for testing
start_php_server() {
    php -S localhost:8000 -t "$ROOT_DIR" >/tmp/php-server.log 2>&1 &
    PHP_SERVER_PID=$!
    STARTED_SERVER=true
    sleep 2
}

# Stop the PHP server if we started it
cleanup() {
    if [ "$STARTED_SERVER" = true ]; then
        echo "🧹 Stopping PHP server..."
        kill $PHP_SERVER_PID 2>/dev/null
    fi
}

trap cleanup EXIT

# Check if server is running
check_server() {
    curl -s http://localhost:8000/php/vers.php > /dev/null 2>&1
    return $?
}

# =============================================================================
# Test Functions
# =============================================================================

test_last_updated_endpoint() {
    echo "🧪 Test 1: Last-updated endpoint basic functionality"
    
    local user_id="test_poll_$(date +%s)"
    
    # Create user
    local create_response=$(curl -s -X POST "$BASE_URL/$user_id")
    if ! echo "$create_response" | grep -q '"success":true'; then
        echo "❌ Failed to create user"
        return 1
    fi
    
    # Get initial last-updated
    local last_updated_1=$(curl -s -X GET "$BASE_URL/$user_id/last-updated")
    if ! echo "$last_updated_1" | grep -q 'last-updated'; then
        echo "❌ Failed to get last-updated timestamp"
        echo "Response: $last_updated_1"
        return 1
    fi
    
    local timestamp_1=$(echo "$last_updated_1" | grep -o '"last-updated":"[^"]*"' | cut -d'"' -f4)
    echo "   Initial timestamp: $timestamp_1"
    
    # Wait a moment
    sleep 2
    
    # Update a setting
    curl -s -X PUT -H "Content-Type: application/json" \
        -d '{"value": true}' "$BASE_URL/$user_id/test-setting" > /dev/null
    
    # Get updated last-updated
    local last_updated_2=$(curl -s -X GET "$BASE_URL/$user_id/last-updated")
    local timestamp_2=$(echo "$last_updated_2" | grep -o '"last-updated":"[^"]*"' | cut -d'"' -f4)
    echo "   Updated timestamp: $timestamp_2"
    
    # Verify timestamps are different
    if [ "$timestamp_1" != "$timestamp_2" ]; then
        echo "✅ Passed: Timestamps are different"
        return 0
    else
        echo "❌ Failed: Timestamps should be different"
        return 1
    fi
}

test_multiple_settings_update() {
    echo "🧪 Test 2: Multiple settings updates timestamp"
    
    local user_id="test_multi_$(date +%s)"
    
    # Create user
    curl -s -X POST "$BASE_URL/$user_id" > /dev/null
    
    # Get initial timestamp
    local last_updated_1=$(curl -s -X GET "$BASE_URL/$user_id/last-updated")
    local timestamp_1=$(echo "$last_updated_1" | grep -o '"last-updated":"[^"]*"' | cut -d'"' -f4)
    
    sleep 1
    
    # Update multiple settings
    curl -s -X PUT -H "Content-Type: application/json" \
        -d '{"value": "value1"}' "$BASE_URL/$user_id/setting1" > /dev/null
    sleep 1
    curl -s -X PUT -H "Content-Type: application/json" \
        -d '{"value": "value2"}' "$BASE_URL/$user_id/setting2" > /dev/null
    
    # Get final timestamp
    local last_updated_2=$(curl -s -X GET "$BASE_URL/$user_id/last-updated")
    local timestamp_2=$(echo "$last_updated_2" | grep -o '"last-updated":"[^"]*"' | cut -d'"' -f4)
    
    echo "   Initial: $timestamp_1"
    echo "   Final:   $timestamp_2"
    
    # Verify timestamp changed and reflects the latest update
    if [ "$timestamp_1" != "$timestamp_2" ]; then
        echo "✅ Passed: Timestamp reflects latest update"
        return 0
    else
        echo "❌ Failed: Timestamp should reflect latest update"
        return 1
    fi
}

test_nonexistent_user() {
    echo "🧪 Test 3: Last-updated for non-existent user"
    
    local response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/nonexistent_user_12345/last-updated")
    local http_code=$(echo "$response" | tail -1)
    
    if [ "$http_code" = "404" ]; then
        echo "✅ Passed: Returns 404 for non-existent user"
        return 0
    else
        echo "❌ Failed: Should return 404, got $http_code"
        return 1
    fi
}

# =============================================================================
# Main Execution
# =============================================================================

# Check if PHP server is running
if ! check_server; then
    echo "⚠️ No PHP server detected, starting one..."
    start_php_server
fi

# Run tests
passed=0
failed=0

if test_last_updated_endpoint; then
    ((passed++))
else
    ((failed++))
fi

echo ""
if test_multiple_settings_update; then
    ((passed++))
else
    ((failed++))
fi

echo ""
if test_nonexistent_user; then
    ((passed++))
else
    ((failed++))
fi

# Summary
echo ""
echo "📊 Test Summary: $passed passed, $failed failed"

if [ $failed -eq 0 ]; then
    echo "✨ All tests passed!"
    exit 0
else
    echo "❌ Some tests failed"
    exit 1
fi
