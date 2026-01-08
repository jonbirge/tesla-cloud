<?php

/**
 * A standalone class to load and access environment variables from a JSON .env file
 * or actual environment variables (for containerized deployments).
 */
class DotEnv {
    /**
     * The path to the .env file.
     *
     * @var string
     */
    private $filePath;

    /**
     * The loaded environment variables.
     *
     * @var array
     */
    private $vars = [];

    /**
     * Constructor for the DotEnv class.
     *
     * @param string $file_path Optional path to .env file (default: './.env')
     */
    public function __construct(string $file_path = '.env') {
        $this->filePath = $file_path;
        $this->load();
    }

    /**
     * Load environment variables from JSON .env file or system environment.
     * Priority: system environment variables > JSON file
     *
     * @return void
     */
    private function load(): void {
        $fileLoaded = false;
        
        // First, try to load from JSON file if it exists
        if (is_readable($this->filePath)) {
            $content = file_get_contents($this->filePath);
            if ($content === false) {
                throw new RuntimeException("Failed to read .env file content.");
            }

            $json = json_decode($content, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new RuntimeException("Invalid JSON in .env file: " . json_last_error_msg());
            }

            $this->vars = $json;
            $fileLoaded = true;
        }

        // Then, override with actual environment variables if they exist
        // This allows containerized deployments to use real env vars
        $envKeys = [
            'SQL_DB_NAME',
            'SQL_HOST',
            'SQL_USER',
            'SQL_PASS',
            'SQL_PORT',
            'OPENWX_KEY',
            'BREVO_KEY',
            'FINNHUB_KEY',
            'SQLITE_PATH'
        ];

        $envVarsFound = false;
        foreach ($envKeys as $key) {
            $value = getenv($key);
            if ($value !== false) {
                $this->vars[$key] = $value;
                $envVarsFound = true;
            }
        }

        // If neither file nor env vars loaded, and file path doesn't look like default,
        // throw exception for backward compatibility
        if (!$fileLoaded && !$envVarsFound && $this->filePath !== self::DEFAULT_ENV_FILE) {
            throw new RuntimeException("Could not read from environment file: $this->filePath");
        }
    }

    /**
     * Default environment file path constant.
     */
    private const DEFAULT_ENV_FILE = '.env';

    /**
     * Get the value of a specific environment variable.
     *
     * @param string $key
     * @return mixed|null
     */
    public function get(string $key) {
        return $this->vars[$key] ?? null;
    }

    /**
     * Check if an environment variable exists.
     *
     * @param string $key
     * @return bool
     */
    public function has(string $key): bool {
        return array_key_exists($key, $this->vars);
    }

    /**
     * Get all environment variables as an associative array.
     *
     * @return array
     */
    public function getAll(): array {
        return $this->vars;
    }
}
