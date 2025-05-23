#!/bin/bash

# =============================================================================
# RestDB API Test Suite
# =============================================================================

# Configuration parameters
BASE_URL="https://teslas.cloud/restdb.php"  # Base URL for the REST API
VERBOSE=false               # Set to true for detailed output
TEMP_DIR="/tmp/restdb_test" # Directory for temporary files
KEEP_DATA=false             # Whether to keep test data after running tests

# Create temporary directory for test responses
mkdir -p ${TEMP_DIR}

echo "🔍 Running RestDB API Tests..."

# =============================================================================
# Helper Functions
# =============================================================================

# Function: send a PUT request
put_request() {
    local path="$1"
    local payload="$2"
    local url="${BASE_URL}/${path}"
    local response_file="${TEMP_DIR}/put_response.txt"
    local headers_file="${TEMP_DIR}/put_headers.txt"
    
    # Make request, save headers to one file and body to another
    curl -s -X PUT -d "$payload" "$url" \
         -D "${headers_file}" \
         -o "${response_file}"
    
    # Extract status code from headers
    local status_code=$(grep -E "^HTTP/" "${headers_file}" | tail -1 | awk '{print $2}')
    local response_body=$(cat "${response_file}")
    
    if $VERBOSE; then
        echo "PUT $url"
        echo "Payload: $payload"
        echo "Status: $status_code"
        echo "Response: $response_body"
    fi
    
    # Return status code and response body
    echo "${status_code}"
    echo "${response_body}"
}

# Function: send a GET request
get_request() {
    local path="$1"
    local url="${BASE_URL}/${path}"
    local response_file="${TEMP_DIR}/get_response.txt"
    local headers_file="${TEMP_DIR}/get_headers.txt"
    
    # Make request, save headers to one file and body to another
    curl -s -X GET "$url" \
         -D "${headers_file}" \
         -o "${response_file}"
    
    # Extract status code from headers
    local status_code=$(grep -E "^HTTP/" "${headers_file}" | tail -1 | awk '{print $2}')
    local response_body=$(cat "${response_file}")
    
    if $VERBOSE; then
        echo "GET $url"
        echo "Status: $status_code"
        echo "Response: $response_body"
    fi
    
    # Return status code and response body
    echo "${status_code}"
    echo "${response_body}"
}

# Function: send a DELETE request
delete_request() {
    local path="$1"
    local url="${BASE_URL}/${path}"
    local response_file="${TEMP_DIR}/del_response.txt"
    local headers_file="${TEMP_DIR}/del_headers.txt"
    
    # Make request, save headers to one file and body to another
    curl -s -X DELETE "$url" \
         -D "${headers_file}" \
         -o "${response_file}"
    
    # Extract status code from headers
    local status_code=$(grep -E "^HTTP/" "${headers_file}" | tail -1 | awk '{print $2}')
    local response_body=$(cat "${response_file}")
    
    if $VERBOSE; then
        echo "DELETE $url"
        echo "Status: $status_code"
        echo "Response: $response_body"
    fi
    
    # Return status code and response body
    echo "${status_code}"
    echo "${response_body}"
}

# Function to run a test case and check its result
run_test() {
    local description="$1"
    local test_func="$2"
    
    echo "🧪 Running: $description"
    
    # Run the test and capture the exit code
    if "$test_func"; then
        echo "✅ Passed: $description"
        return 0
    else
        echo "❌ Failed: $description"
        return 1
    fi
}

# Function to clean up all test data
cleanup_test_data() {
    if $KEEP_DATA; then
        echo "🔒 Keeping test data as requested (--keep flag was used)"
        return 0
    fi
    
    echo "🧹 Cleaning up test data..."
    
    # Directories created during tests
    local dirs_to_delete=("dir1/" "dir2/")
    
    # Root level keys created during tests
    local keys_to_delete=("root_key" "another_root_key" "root_single_key")
    
    # Delete directories and their contents
    for dir in "${dirs_to_delete[@]}"; do
        local delete_status=$(delete_request "$dir" | head -1)
        
        if [ "$delete_status" -eq 200 ]; then
            echo "  ✓ Deleted directory: $dir"
        elif $VERBOSE; then
            echo "  ✗ Failed to delete directory: $dir (status $delete_status)"
        fi
    done
    
    # Delete individual keys
    for key in "${keys_to_delete[@]}"; do
        local delete_status=$(delete_request "$key" | head -1)
        
        if [ "$delete_status" -eq 200 ]; then
            echo "  ✓ Deleted key: $key"
        elif $VERBOSE; then
            echo "  ✗ Failed to delete key: $key (status $delete_status)"
        fi
    done
    
    echo "🧹 Cleanup completed"
    return 0
}

# =============================================================================
# Test Cases
# =============================================================================

# Test 1: Store a value with PUT, retrieve it via GET
test_put_get() {
    local key="dir1/key1"
    local payload='{"key": "value1"}'
    
    # Send the PUT request
    local put_status=$(put_request "$key" "$payload" | head -1)
    local put_body=$(put_request "$key" "$payload" | tail -1)
    
    # Validate PUT response
    if [ "$put_status" -ne 201 ]; then
        echo "PUT failed with status $put_status"
        echo "Response body: $put_body"
        return 1
    fi

    # Send the GET request
    local get_status=$(get_request "$key" | head -1)
    local get_body=$(get_request "$key" | tail -1)
    
    # Validate GET response
    if [ "$get_status" -ne 200 ]; then
        echo "GET failed with status $get_status"
        echo "Response body: $get_body"
        return 1
    fi

    # Validate response body
    expected='{"key": "value1"}'
    if [[ "$get_body" != *"$expected"* ]]; then
        echo "GET response does not match expected content"
        echo "Expected: $expected"
        echo "Actual: $get_body"
        return 1
    fi

    return 0
}

# Test 2: Prefix search on a directory (ends with '/')
test_prefix_search() {
    local dir="dir1"
    
    # Store some values under this prefix
    put_request "$dir/key1" '{"key": "value1"}' > /dev/null
    put_request "$dir/dir2/key2" '{"key": "value2"}' > /dev/null

    # Get the list of all keys matching the prefix
    local get_status=$(get_request "$dir/" | head -1)
    local get_body=$(get_request "$dir/" | tail -1)
    
    # Validate response status
    if [ "$get_status" -ne 200 ]; then
        echo "Prefix search failed with status $get_status"
        echo "Response body: $get_body"
        return 1
    fi

    # Simplified check: just look for the values we stored
    if [[ "$get_body" != *"value1"* ]] || [[ "$get_body" != *"value2"* ]]; then
        echo "Prefix search result does not contain expected values"
        echo "Expected to find: value1 and value2"
        echo "Actual: $get_body"
        return 1
    fi

    return 0
}

# Test 3: Exact match on a key (no trailing slash)
test_exact_match() {
    local key="dir2/key2"
    
    # Setup test data
    put_request "$key" '{"key": "value2"}' > /dev/null
    
    # Execute test
    local get_status=$(get_request "$key" | head -1)
    local get_body=$(get_request "$key" | tail -1)
    
    # Validate response status
    if [ "$get_status" -ne 200 ]; then
        echo "Exact match failed with status $get_status"
        echo "Response body: $get_body"
        return 1
    fi

    # Validate response body
    expected='{"key": "value2"}'
    if [[ "$get_body" != *"$expected"* ]]; then
        echo "Exact match response does not match expected content"
        echo "Expected: $expected"
        echo "Actual: $get_body"
        return 1
    fi

    return 0
}

# Test 4: Root level operations
test_root_level_operations() {
    # Clean up - delete any existing root level keys
    curl -s -X DELETE "$BASE_URL/" > /dev/null

    # Store root level key
    local root_key="root_key"
    local root_payload='{"root": "value"}'
    
    # PUT a root level key
    put_request "$root_key" "$root_payload" > /dev/null
    
    # PUT another root level key
    put_request "another_root_key" '{"another": "value"}' > /dev/null
    
    # GET the root level key directly
    local get_status=$(get_request "$root_key" | head -1)
    local get_body=$(get_request "$root_key" | tail -1)
    
    # Validate response status and content
    if [ "$get_status" -ne 200 ] || [[ "$get_body" != *"$root_payload"* ]]; then
        echo "Root level key retrieval failed"
        echo "Status: $get_status, Expected: 200"
        echo "Body: $get_body, Expected: $root_payload"
        return 1
    fi
    
    # Now test listing of root level keys (no path or just /)
    local list_status=$(get_request "" | head -1)
    local list_body=$(get_request "" | tail -1)
    
    # Also test with explicit slash
    local list_status_slash=$(get_request "/" | head -1)
    local list_body_slash=$(get_request "/" | tail -1)
    
    # Validate root listing responses
    if [ "$list_status" -ne 200 ] || [ "$list_status_slash" -ne 200 ]; then
        echo "Root level listing failed"
        echo "Status (empty path): $list_status, Expected: 200"
        echo "Status (slash path): $list_status_slash, Expected: 200"
        return 1
    fi
    
    # Check for root level keys in both responses
    if [[ "$list_body" != *"$root_key"* ]] || [[ "$list_body" != *"another_root_key"* ]]; then
        echo "Root level listing (empty path) missing expected keys"
        echo "Body: $list_body"
        echo "Should contain: $root_key and another_root_key"
        return 1
    fi
    
    if [[ "$list_body_slash" != *"$root_key"* ]] || [[ "$list_body_slash" != *"another_root_key"* ]]; then
        echo "Root level listing (slash path) missing expected keys"
        echo "Body: $list_body_slash"
        echo "Should contain: $root_key and another_root_key"
        return 1
    fi
    
    return 0
}

# Test 5: Put and Get a single key at root level
test_root_level_single_key() {
    local key_name="root_single_key"
    local payload='{"name":"root value","test":true,"number":42}'
    
    # PUT a key at root level
    local put_status=$(put_request "$key_name" "$payload" | head -1)
    local put_body=$(put_request "$key_name" "$payload" | tail -1)
    
    # Validate PUT response
    if [ "$put_status" -ne 201 ]; then
        echo "PUT failed for root level key with status $put_status"
        echo "Response body: $put_body"
        return 1
    fi

    # GET the root level key
    local get_status=$(get_request "$key_name" | head -1)
    local get_body=$(get_request "$key_name" | tail -1)
    
    # Validate GET response
    if [ "$get_status" -ne 200 ]; then
        echo "GET failed for root level key with status $get_status"
        echo "Response body: $get_body"
        return 1
    fi

    # Validate response body by comparing key components
    if [[ "$get_body" != *"root value"* ]] || 
       [[ "$get_body" != *"true"* ]] || 
       [[ "$get_body" != *"42"* ]]; then
        echo "GET response for root level key does not match expected content"
        echo "Expected payload: $payload"
        echo "Actual response: $get_body"
        return 1
    fi

    # Verify the key shows up in the root listing
    local list_status=$(get_request "/" | head -1)
    local list_body=$(get_request "/" | tail -1)
    
    if [ "$list_status" -ne 200 ] || [[ "$list_body" != *"$key_name"* ]]; then
        echo "Root level key not found in root listing"
        echo "Status: $list_status, Expected: 200"
        echo "Body: $list_body should contain $key_name"
        return 1
    fi

    return 0
}

# Test 6: Delete operations
test_delete_operations() {
    local key="delete_test_key"
    local dir="delete_test_dir"
    local payload='{"test": "delete_me"}'
    
    # Create a key and directory to delete
    put_request "$key" "$payload" > /dev/null
    curl -s -X POST "${BASE_URL}/${dir}" > /dev/null
    put_request "${dir}/subkey" "$payload" > /dev/null
    
    # Test deleting a key
    local key_delete_status=$(delete_request "$key" | head -1)
    local key_delete_body=$(delete_request "$key" | tail -1)
    
    # Validate key deletion
    if [ "$key_delete_status" -ne 200 ]; then
        echo "DELETE key failed with status $key_delete_status"
        echo "Response body: $key_delete_body"
        return 1
    fi
    
    # Verify key is gone
    local get_status=$(get_request "$key" | head -1)
    if [ "$get_status" -ne 404 ]; then
        echo "Key was not deleted properly, GET returned $get_status"
        return 1
    fi
    
    # Test deleting a directory
    local dir_delete_status=$(delete_request "${dir}/" | head -1)
    local dir_delete_body=$(delete_request "${dir}/" | tail -1)
    
    # Validate directory deletion
    if [ "$dir_delete_status" -ne 200 ]; then
        echo "DELETE directory failed with status $dir_delete_status"
        echo "Response body: $dir_delete_body"
        return 1
    fi
    
    # Verify directory and contents are gone
    local get_dir_status=$(get_request "${dir}/" | head -1)
    if [ "$get_dir_status" -ne 404 ]; then
        echo "Directory was not deleted properly, GET returned $get_dir_status"
        return 1
    fi
    
    return 0
}

# =============================================================================
# Main Test Runner
# =============================================================================

# Run all tests
run_test_suite() {
    # Array of test functions
    local tests=("test_put_get" "test_prefix_search" "test_exact_match" "test_root_level_operations" "test_root_level_single_key" "test_delete_operations")
    
    local failed=0
    local passed=0
    
    for test_func in "${tests[@]}"; do
        local test_name="${test_func#test_}"
        
        if run_test "$test_name" "$test_func"; then
            ((passed++))
        else
            ((failed++))
        fi
        
        echo ""
    done
    
    echo "📊 Test Summary: $passed passed, $failed failed"
    
    # Run cleanup after tests
    cleanup_test_data
    
    if [ $failed -gt 0 ]; then
        echo "❌ Some tests failed!"
        return 1
    else
        echo "✨ All tests passed!"
        return 0
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        -h|--host)
            BASE_URL="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -k|--keep)
            KEEP_DATA=true
            shift
            ;;
        *)
            echo "Unknown option: $key"
            echo "Usage: $0 [-h|--host BASE_URL] [-v|--verbose] [-k|--keep]"
            exit 1
            ;;
    esac
done

# Print test configuration
echo "⚙️ Test Configuration:"
echo "Base URL: $BASE_URL"
echo "Verbose mode: $VERBOSE"
echo "Keep test data: $KEEP_DATA"
echo "Temp directory: $TEMP_DIR"
echo ""

# Run the test suite
run_test_suite
exit_code=$?

# Clean up temp files
rm -rf ${TEMP_DIR}

exit $exit_code
