<?php

/**
 * A standalone class to load and access environment variables from a JSON .env file.
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
     * Load the JSON .env file and store its contents in `$this->vars`.
     *
     * @return void
     */
    private function load(): void {
        if (!is_readable($this->filePath)) {
            throw new RuntimeException("Could not read from environment file: $this->filePath");
        }

        $content = file_get_contents($this->filePath);
        if ($content === false) {
            throw new RuntimeException("Failed to read .env file content.");
        }

        $json = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException("Invalid JSON in .env file: " . json_last_error_msg());
        }

        $this->vars = $json;
    }

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
