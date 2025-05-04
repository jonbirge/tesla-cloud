/**
 * Position Simulator Module
 * Simulates GPS positions for testing purposes
 */

/**
 * Class representing a position simulator that generates fake GPS positions for testing
 */
export class PositionSimulator {
  /**
   * Create a position simulator
   * @param {Object} config - Configuration options
   * @param {number} [config.centerLat=39.7392] - Center latitude (Denver)
   * @param {number} [config.centerLong=-104.9903] - Center longitude (Denver)
   * @param {number} [config.radius=10] - Circle radius in miles
   * @param {number} [config.minSpeed=75] - Minimum speed in mph
   * @param {number} [config.maxSpeed=95] - Maximum speed in mph
   * @param {number} [config.minAlt=50] - Minimum altitude in feet
   * @param {number} [config.maxAlt=250] - Maximum altitude in feet
   */
  constructor(config = {}) {
    // Configuration with defaults
    this.centerLat = config.centerLat ?? 39.7392; // Denver
    this.centerLong = config.centerLong ?? -104.9903; // Denver
    this.radius = config.radius ?? 10; // miles
    this.minSpeed = config.minSpeed ?? 75; // mph
    this.maxSpeed = config.maxSpeed ?? 95; // mph
    this.minAlt = config.minAlt ?? 50; // feet
    this.maxAlt = config.maxAlt ?? 250; // feet
    
    // Internal state
    this._angle = 0;
    this._speed = this.minSpeed;
    this._alt = this.minAlt;
    this._speedIncreasing = true;
    this._altIncreasing = true;
  }

  /**
   * Reset the simulator to initial state
   */
  reset() {
    this._angle = 0;
    this._speed = this.minSpeed;
    this._alt = this.minAlt;
    this._speedIncreasing = true;
    this._altIncreasing = true;
    return this;
  }

  /**
   * Update the simulator configuration
   * @param {Object} config - Configuration parameters to update
   * @returns {PositionSimulator} - This simulator instance for chaining
   */
  updateConfig(config = {}) {
    if (config.centerLat !== undefined) this.centerLat = config.centerLat;
    if (config.centerLong !== undefined) this.centerLong = config.centerLong;
    if (config.radius !== undefined) this.radius = config.radius;
    if (config.minSpeed !== undefined) this.minSpeed = config.minSpeed;
    if (config.maxSpeed !== undefined) this.maxSpeed = config.maxSpeed;
    if (config.minAlt !== undefined) this.minAlt = config.minAlt;
    if (config.maxAlt !== undefined) this.maxAlt = config.maxAlt;
    return this;
  }

  /**
   * Get a simulated position and ratchet to next state
   * @returns {Object} Position object compatible with Geolocation API format
   */
  getPosition() {
    // Calculate new position based on angle
    const radiusInDegrees = this.radius / 69; // Rough conversion from miles to degrees
    const testLat = this.centerLat + radiusInDegrees * Math.cos(this._angle);
    const testLong = this.centerLong + radiusInDegrees * Math.sin(this._angle);
    
    // Update angle for next time (move about 1 degree per second at current speed)
    const angleIncrement = (this._speed / (2 * Math.PI * this.radius)) * (2 * Math.PI) / (60 * 60);
    this._angle = (this._angle + angleIncrement) % (2 * Math.PI);
    
    // Update speed (oscillate between min and max)
    if (this._speedIncreasing) {
      this._speed += 0.1;
      if (this._speed >= this.maxSpeed) {
        this._speedIncreasing = false;
      }
    } else {
      this._speed -= 0.1;
      if (this._speed <= this.minSpeed) {
        this._speedIncreasing = true;
      }
    }
    
    // Update altitude (oscillate between min and max)
    if (this._altIncreasing) {
      this._alt += 0.5;
      if (this._alt >= this.maxAlt) {
        this._altIncreasing = false;
      }
    } else {
      this._alt -= 0.5;
      if (this._alt <= this.minAlt) {
        this._altIncreasing = true;
      }
    }

    // Calculate heading based on movement around the circle
    const heading = (((this._angle * 180 / Math.PI) + 90) % 360);

    return {
      coords: {
        latitude: testLat,
        longitude: testLong,
        altitude: this._alt * 0.3048, // Convert feet to meters
        speed: this._speed * 0.44704, // Convert mph to m/s
        heading: heading,
        accuracy: 5, // Simulate a good GPS signal with 5m accuracy
      },
      timestamp: Date.now(),
    };
  }
  
  /**
   * Get the current configuration and state of the simulator
   * @returns {Object} Configuration object with all settings and current state
   */
  getConfig() {
    return {
      centerLat: this.centerLat,
      centerLong: this.centerLong,
      radius: this.radius,
      minSpeed: this.minSpeed,
      maxSpeed: this.maxSpeed,
      minAlt: this.minAlt,
      maxAlt: this.maxAlt,
      currentSpeed: this._speed,
      currentAlt: this._alt,
      currentAngle: this._angle
    };
  }
}
