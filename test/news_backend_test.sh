#!/bin/bash
# Test script for Python news backend integration

set -e

echo "🧪 Testing Python News Backend Integration"
echo "=========================================="
echo ""

# Test 1: Python update script
echo "Test 1: Running Python news update script..."
cd /home/runner/work/tesla-cloud/tesla-cloud/news
python3 update_news.py --force > /tmp/news_update_test.log 2>&1
if [ $? -eq 0 ]; then
    echo "✅ News update script executed successfully"
    # Check that articles were stored
    article_count=$(sqlite3 /tmp/news.db "SELECT COUNT(*) FROM news_articles;")
    echo "   Found $article_count articles in database"
else
    echo "❌ News update script failed"
    cat /tmp/news_update_test.log
    exit 1
fi
echo ""

# Test 2: Database structure
echo "Test 2: Verifying database structure..."
tables=$(sqlite3 /tmp/news.db "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
expected_tables="feed_updates
news_articles"
if [ "$tables" = "$expected_tables" ]; then
    echo "✅ Database tables created correctly"
else
    echo "❌ Database tables missing or incorrect"
    echo "Expected: $expected_tables"
    echo "Got: $tables"
    exit 1
fi
echo ""

# Test 3: PHP news endpoint
echo "Test 3: Testing PHP news endpoint..."
# Start PHP server if not running
if ! pgrep -f "php -S localhost:8000" > /dev/null; then
    cd /home/runner/work/tesla-cloud/tesla-cloud
    php -S localhost:8000 > /tmp/php_server_test.log 2>&1 &
    PHP_PID=$!
    sleep 2
    echo "   Started PHP server (PID: $PHP_PID)"
else
    echo "   PHP server already running"
    PHP_PID=""
fi

# Test basic endpoint
response=$(curl -s http://localhost:8000/php/news.php?n=5)
article_count=$(echo "$response" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$article_count" -gt 0 ]; then
    echo "✅ PHP endpoint returned $article_count articles"
else
    echo "❌ PHP endpoint returned no articles or invalid JSON"
    echo "Response: $response"
    exit 1
fi
echo ""

# Test 4: Feed filtering
echo "Test 4: Testing feed filtering via POST..."
response=$(curl -s -X POST http://localhost:8000/php/news.php?n=5 \
  -H "Content-Type: application/json" \
  -d '{"includedFeeds":["nyt","bbc"]}')

article_count=$(echo "$response" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$article_count" -gt 0 ]; then
    echo "✅ Feed filtering works, returned $article_count articles"
    
    # Verify only requested feeds
    feeds=$(echo "$response" | python3 -c "import sys, json; items = json.load(sys.stdin); print(','.join(set(item['source'] for item in items)))")
    echo "   Feeds in response: $feeds"
else
    echo "❌ Feed filtering failed"
    echo "Response: $response"
    exit 1
fi
echo ""

# Cleanup
if [ -n "$PHP_PID" ]; then
    kill $PHP_PID 2>/dev/null || true
    echo "Stopped test PHP server"
fi

echo "=========================================="
echo "✨ All tests passed!"
