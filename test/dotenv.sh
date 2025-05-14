#!/bin/bash

# Define the path to your DotEnv.php file
DOTENV_PATH="../dotenv.php"

# Define test environment files (relative to current directory)
TEST_ENVS_DIR="./test_envs"

# Create test directory if it doesn't exist
mkdir -p ${TEST_ENVS_DIR}

echo "🔍 Running DotEnv Tests..."

# Function to run a test case and check its result
run_test() {
  local description="$1"
  local env_file="$2"
  local expected_exit_code="$3"
  local expected_output="$4"
  local script_content="$5"

  echo "🧪 Running: $description"
  
  # Create a temporary PHP file with the test logic
  local tmp_php=$(mktemp /tmp/test_XXXXXX.php)
  
  # Create proper PHP test script with actual file path
  cat > "$tmp_php" << EOF
<?php
require_once '$DOTENV_PATH';
define('TEST_ENVS_DIR', '$TEST_ENVS_DIR');
$script_content
EOF

  # Run the test and capture output and exit code
  result=$(php "$tmp_php" 2>&1)
  exit_code=$?

  # Clean up the temporary file
  rm -f "$tmp_php"

  # Validate the results
  if [ $exit_code -eq $expected_exit_code ]; then
    echo "✅ Passed: Exit code matches expected ($expected_exit_code)"
  else
    echo "❌ Failed: Exit code mismatch (Expected $expected_exit_code, Got $exit_code)"
    echo "Error Output:"
    echo "$result"
    exit 1
  fi

  # Optional: Check for expected output (if provided)
  if [ -n "$expected_output" ]; then
    if [[ "$result" == *"$expected_output"* ]]; then
      echo "✅ Expected output found"
    else
      echo "❌ Unexpected output"
      echo "Expected:"
      echo "$expected_output"
      echo "Got:"
      echo "$result"
      exit 1
    fi
  fi

  echo ""
}

# Test Case: Load a valid .env file
run_test \
  "Load valid environment variables" \
  "valid.env.json" \
  0 \
  "DB_HOST: localhost
DB_USER: root
DB_PASS: yourpassword
DB_NAME: mydatabase" \
  '
$dotenv = new DotEnv(TEST_ENVS_DIR . "/valid.env.json");
$vars = $dotenv->getAll();
foreach ($vars as $key => $value) {
    echo "$key: $value\n";
}
'

# Test Case: Try to load a non-existent .env file
run_test \
  "Attempt to load missing .env file" \
  "missing.env.json" \
  1 \
  "Could not read from environment file" \
  '
try {
  $dotenv = new DotEnv(TEST_ENVS_DIR . "/missing.env.json");
} catch (Exception $e) {
  echo $e->getMessage();
  exit(1);
}
'

# Test Case: Load an invalid JSON .env file
run_test \
  "Attempt to load invalid JSON .env" \
  "invalid.env.json" \
  1 \
  "Invalid JSON in .env file" \
  '
try {
  $dotenv = new DotEnv(TEST_ENVS_DIR . "/invalid.env.json");
} catch (Exception $e) {
  echo $e->getMessage();
  exit(1);
}
'

# Test Case: Access a non-existent environment variable
run_test \
  "Access unknown environment variable" \
  "valid.env.json" \
  0 \
  "NULL" \
  '
$dotenv = new DotEnv(TEST_ENVS_DIR . "/valid.env.json");
$value = $dotenv->get("UNKNOWN_KEY");
var_dump($value);
'

# Test Case: Get all variables
run_test \
  "Get all environment variables" \
  "valid.env.json" \
  0 \
  "DB_HOST: localhost
DB_USER: root
DB_PASS: yourpassword
DB_NAME: mydatabase" \
  '
$dotenv = new DotEnv(TEST_ENVS_DIR . "/valid.env.json");
$vars = $dotenv->getAll();
foreach ($vars as $key => $value) {
    echo "$key: $value\n";
}
'

# Test Case: Check if a variable exists with has() method
run_test \
  "Check if variable exists with has() method" \
  "valid.env.json" \
  0 \
  "Has DB_HOST: Yes
Has UNKNOWN_KEY: No" \
  '
$dotenv = new DotEnv(TEST_ENVS_DIR . "/valid.env.json");
echo "Has DB_HOST: " . ($dotenv->has("DB_HOST") ? "Yes" : "No") . "\n";
echo "Has UNKNOWN_KEY: " . ($dotenv->has("UNKNOWN_KEY") ? "Yes" : "No") . "\n";
'

echo "✨ All tests passed!"
