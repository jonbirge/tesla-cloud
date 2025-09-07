# Tesla Cloud Development Instructions

Tesla Cloud is a JavaScript+PHP web application designed for Tesla's in-car browser. It provides news, weather, navigation, and other features optimized for vehicle use.

**ALWAYS reference these instructions first and only fallback to search or bash commands when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Prerequisites
- PHP 8.2+ (available via devcontainer or system install)
- No complex build process required - this is a simple web application

### Core Development Commands
Run these commands from the repository root directory:

1. **Start Development Server**:
   ```bash
   php -S localhost:8000
   ```
   - Takes ~2 seconds to start
   - Serves the application at http://localhost:8000
   - NEVER CANCEL - Let it run until you manually stop it with Ctrl+C
   - Creates a local SQLite database automatically in `/tmp/` for testing

2. **Run API Tests**:
   ```bash
   ./test/restdb.sh
   ```
   - Takes ~1.5 seconds to complete
   - Tests all REST database endpoints
   - Automatically starts a temporary PHP server if none is running
   - NEVER CANCEL - Set timeout to 60+ seconds for safety

3. **Run Environment Tests**:
   ```bash
   cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh
   ```
   - Takes ~0.5 seconds to complete
   - Tests PHP environment configuration loading
   - Requires absolute path to work correctly

### Validation Scenarios
**ALWAYS test these scenarios after making changes:**

1. **Basic Application Load**:
   - Start PHP server: `php -S localhost:8000`
   - Open browser to http://localhost:8000
   - Verify homepage loads with navigation menu
   - Click different sections (News, Weather, etc.) to ensure navigation works

2. **API Functionality**:
   - Test version endpoint: `curl -s http://localhost:8000/php/vers.php`
   - Should return JSON with git commit info
   - Test REST DB: `curl -s http://localhost:8000/php/rest_db.php/test -X PUT -d '{"test":"data"}' -H "Content-Type: application/json"`
   - Should return success message

3. **Core User Workflow**:
   - Navigate to different sections in the web interface
   - Verify stock tickers display (may show "--" without external APIs)
   - Test responsive design works in browser
   - Check browser console for critical errors (ignore external API failures)

## Repository Structure

### Key Directories
- `index.html` - Main application entry point
- `js/` - Frontend JavaScript modules (app.js, settings.js, news.js, etc.)
- `css/` - Stylesheets for the application
- `php/` - Backend API endpoints and utilities
- `test/` - Test scripts for validation
- `assets/` - Static assets (images, icons)

### Important Files
- `php/rest_db.php` - REST API for data storage using SQLite
- `php/settings.php` - User settings management
- `php/news.php` - News aggregation from RSS feeds
- `php/vers.php` - Version and git information
- `js/app.js` - Main application logic and navigation
- `js/settings.js` - User authentication and settings management

### Configuration Files
- `.devcontainer/devcontainer.json` - VS Code dev container setup (PHP 8.2, Node 20)
- `.github/workflows/codeql.yml` - CodeQL security scanning
- `test/test_envs/` - Test environment configurations

## Development Workflow

### Making Changes
1. **Always run tests first** to establish baseline:
   ```bash
   ./test/restdb.sh
   cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh
   ```

2. **Start development server**:
   ```bash
   php -S localhost:8000
   ```

3. **Make your changes** to relevant files (js/, php/, css/, or index.html)

4. **Test changes**:
   - Refresh browser to see frontend changes
   - Restart PHP server if you changed PHP files
   - Run test scripts to verify API functionality
   - Test user scenarios manually

5. **Validate all functionality** before committing

### Common Issues and Solutions
- **DotEnv test fails**: Use absolute path - `cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh`
- **Server won't start**: Check if port 8000 is in use - `pkill -f "php -S localhost:8000"` then restart
- **External API errors**: Normal in development - many endpoints require external services and API keys
- **Stock data shows "--"**: Expected without external API keys - focus on functionality, not data display
- **Chart.js errors**: Normal - external CDN may be blocked, core functionality still works

### Working Without External Dependencies
The application is designed to work without external dependencies for core development:
- News feeds may be empty (external RSS feeds)
- Stock prices may show "--" (external financial APIs)
- Weather may not load (external weather APIs)
- Some features require `.env` file with API keys

**Focus on core functionality and UI/UX rather than external API integration during development.**

### No Build Process
This application requires no compilation or build step:
- Edit files directly
- Refresh browser to see changes
- Only restart PHP server when changing backend code

### Timing Expectations
- **Server startup**: 2 seconds
- **Test execution**: 1.5 seconds (restdb), 0.5 seconds (dotenv)
- **Page load**: < 1 second for cached resources
- **NEVER CANCEL** any command that takes less than 30 seconds

### Browser Testing
- Test in multiple browser sizes for responsive design
- Check browser console for JavaScript errors (ignore external CDN failures)
- Verify touch-friendly interface (designed for car touchscreens)
- Test login functionality creates and manages user sessions

## Frequently Used Commands

### Quick Repository Status
```bash
ls -la
# Shows: index.html, js/, php/, css/, test/, assets/, .github/
```

### Test All Components
```bash
# Run all tests in sequence
./test/restdb.sh && cd test && DOTENV_PATH="$(pwd)/../php/dotenv.php" bash dotenv.sh && echo "All tests passed"
```

### Start Development Environment
```bash
# Start server and test endpoints
php -S localhost:8000 &
sleep 2
curl -s http://localhost:8000/php/vers.php | head -3
```

### Check Running Processes
```bash
ps aux | grep php
# Shows any running PHP servers
```

This application is designed for simplicity - focus on functionality testing rather than complex build processes.