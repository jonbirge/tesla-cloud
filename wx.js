// Import required functions from app.js
import { customLog, formatTime, highlightUpdate } from './common.js';
import { settings, turnOffDarkMode, turnOnDarkMode } from './settings.js';

// Constants
const OPENWX_API_KEY = '6a1b1bcb03b5718a9b3a2b108ce3293d';

// Global variables
let weatherData = null;
let sunrise = null;
let sunset = null;
let forecastData = null;
let moonPhaseData = null;
let lastLat = null;
let lastLong = null;

// Export these variables for use in other modules
export { sunrise, sunset, weatherData };

// Helper function to convert temperature based on user settings
function formatTemperature(tempF) {
    if (!settings || settings["imperial-units"]) {
        return Math.round(tempF) + "°";
    } else {
        // Convert F to C: (F - 32) * 5/9
        return Math.round((tempF - 32) * 5/9) + "°";
    }
}

// Helper function to convert wind speed based on user settings
function formatWindSpeed(speedMS) {
    if (!settings || settings["imperial-units"]) {
        // Convert m/s to mph
        return Math.round(speedMS * 2.237) + " MPH";
    } else {
        // Keep as m/s
        return Math.round(speedMS) + " m/s";
    }
}

// Convert numerical phase to human-readable name
function getMoonPhaseName(phase) {
    if (phase === 0 || phase === 1) return "New Moon";
    if (phase < 0.25) return "Waxing Crescent";
    if (phase === 0.25) return "First Quarter";
    if (phase < 0.5) return "Waxing Gibbous";
    if (phase === 0.5) return "Full Moon";
    if (phase < 0.75) return "Waning Gibbous";
    if (phase === 0.75) return "Last Quarter";
    return "Waning Crescent";
}

// Fetches weather data and updates the display
export function fetchWeatherData(lat, long, silentLoad = true) {
    customLog('Fetching weather data...' + (silentLoad ? ' (background load)' : ''));
    
    // Save so we can call functions later outside GPS update loop, if needed
    lastLat = lat;
    lastLong = long;

    // Show loading spinner, hide forecast container - only if not silent loading
    const forecastContainer = document.getElementById('forecast-container');
    const loadingSpinner = document.getElementById('forecast-loading');
    
    if (!silentLoad) {
        if (forecastContainer) forecastContainer.style.display = 'none';
        if (loadingSpinner) loadingSpinner.style.display = 'flex';
    }

    // Fetch and update sunrise/sunset data
    fetchSunData(lat, long);

    // Fetch and update weather data
    Promise.all([
        fetch(`https://secure.geonames.org/findNearByWeatherJSON?lat=${lat}&lng=${long}&username=birgefuller`),
        fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${long}&appid=${OPENWX_API_KEY}&units=imperial`)
    ])
        .then(([currentResponse, forecastResponse]) => Promise.all([
            currentResponse.json(),
            forecastResponse ? forecastResponse.json() : null
        ]))
        .then(([currentDataResponse, forecastDataResponse]) => {
            
            if (currentDataResponse) {
                // check to see if wind direction is NaN
                if (isNaN(currentDataResponse.weatherObservation.windDirection)) {
                    currentDataResponse.weatherObservation.windDirection = null;
                    currentDataResponse.weatherObservation.windSpeed = null;
                } else {
                    // take the reciprocal of the wind direction to get the wind vector
                    currentDataResponse.weatherObservation.windDirection =
                        (currentDataResponse.weatherObservation.windDirection + 180) % 360;
                }
                weatherData = currentDataResponse.weatherObservation;
                updateWeatherDisplay();
            }

            if (forecastDataResponse) {
                forecastData = forecastDataResponse.list;
                updateForecastDisplay();
            }

            // Call updateAQI after forecast is obtained
            updateAQI(lat, long, OPENWX_API_KEY);
            
            // Hide spinner and show forecast when data is loaded - only if not silent loading
            if (forecastContainer) forecastContainer.style.display = 'flex';
            if (loadingSpinner) loadingSpinner.style.display = 'none';
        })
        .catch(error => {
            console.error('Error fetching weather data: ', error);
            customLog('Error fetching weather data: ', error);
            
            // In case of error, hide spinner and show error message - only if not silent loading
            if (!silentLoad) {
                if (loadingSpinner) loadingSpinner.style.display = 'none';
                if (forecastContainer) {
                    forecastContainer.style.display = 'flex';
                    // Show error message in the forecast container
                    forecastContainer.innerHTML = '<div class="error-message">Unable to load weather data</div>';
                }
            }
        });
}

// Fetches sunrise and moon phase data
function fetchSunData(lat, long) {
    // Log the lat/long for debugging
    customLog(`Fetching sun data for lat: ${lat}, long: ${long}`);
    Promise.all([
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${Math.floor(Date.now() / 1000)}`)
    ])
        .then(([sunResponse, moonResponse]) => Promise.all([sunResponse.json(), moonResponse.json()]))
        .then(([sunData, moonData]) => {
            sunrise = sunData.results.sunrise;
            sunset = sunData.results.sunset;
            moonPhaseData = moonData[0];
            updateSunMoonDisplay();
            autoDarkMode(lat, long);
        })
        .catch(error => {
            console.error('Error fetching sun/moon data: ', error);
            customLog('Error fetching sun/moon data: ', error);
        });
}

// Updates the display for sunrise, sunset, and moon phase
function updateSunMoonDisplay() {
    const sunriseTime = formatTime(new Date(sunrise), {
        timeZoneName: 'short'
    });
    highlightUpdate('sunrise', sunriseTime);

    const sunsetTime = formatTime(new Date(sunset), {
        timeZoneName: 'short'
    });
    highlightUpdate('sunset', sunsetTime);
    
    if (moonPhaseData) {
        const moonPhase = getMoonPhaseName(moonPhaseData.Phase);
        highlightUpdate('moonphase', moonPhase);
    }
}

// Automatically toggles dark mode based on sunrise and sunset times
export function autoDarkMode(lat, long) {
    // if lat or long are null, then replace with last known values
    if (lat == null || long == null) {
        if (lastLat && lastLong) {
            lat = lastLat;
            long = lastLong;
        } else {
            customLog('autoDarkMode: No coordinates available.');
            return;
        }
    }

    customLog('Auto dark mode check for coordinates: ', lat, long);
    if (!sunrise || !sunset) {
        customLog('autoDarkMode: sunrise/sunset data not available.');
        return;
    }

    if (settings && settings['auto-dark-mode']) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            customLog('Applying dark mode based on sunset...');
            turnOnDarkMode();
        } else {
            customLog('Applying light mode based on sunrise...');
            turnOffDarkMode();
        }
    } else {
        customLog('Auto dark mode disabled or coordinates not available.');
    }
}

// Checks if a day has hazardous weather conditions
function dayHasHazards(forecastList) {
    const hazardConditions = ['Rain', 'Snow', 'Sleet', 'Hail', 'Thunderstorm', 'Storm', 'Drizzle'];
    return forecastList.weather.some(w => 
        hazardConditions.some(condition => 
            w.main.includes(condition) || w.description.includes(condition.toLowerCase())
        )
    );
}

// Updates the forecast display with daily data
function updateForecastDisplay() {
    const forecastDays = document.querySelectorAll('.forecast-day');
    const dailyData = extractDailyForecast(forecastData);
    
    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            
            // Clear previous content and classes
            dayElement.innerHTML = '';
            dayElement.className = 'forecast-day';
            
            // Add weather condition class based on main weather condition
            const weatherCondition = day.weather[0].main.toLowerCase();
            dayElement.classList.add(weatherCondition);
            
            // Add alert symbol if hazards detected
            if (dayHasHazards(day)) {
                const alert = document.createElement('div');
                alert.className = 'forecast-alert';
                alert.innerHTML = '⚠️';
                dayElement.appendChild(alert);
            }
            
            // Add the rest of the forecast content
            dayElement.innerHTML += `
            <div class="forecast-date">${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <img class="forecast-icon" src="https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png" alt="${day.weather[0].description}">
            <div class="forecast-temp">${formatTemperature(day.temp_min)}/${formatTemperature(day.temp_max)}</div>
            <div class="forecast-desc">${day.weather[0].main}</div>
            `;
        }
    });
    
    // After updating the forecast display, check for weather hazards
    checkWeatherHazards();
}

// Summarizes forecast data into daily data
function extractDailyForecast(forecastList) {
    const dailyData = [];
    const dayMap = new Map();
    
    forecastList.forEach(item => {
        const date = new Date(item.dt * 1000).toDateString();
        
        if (!dayMap.has(date)) {
            dayMap.set(date, {
                dt: item.dt,
                temp_min: item.main.temp_min,
                temp_max: item.main.temp_max,
                weather: [item.weather[0]]
            });
        } else {
            const existing = dayMap.get(date);
            existing.temp_min = Math.min(existing.temp_min, item.main.temp_min);
            existing.temp_max = Math.max(existing.temp_max, item.main.temp_max);
            if (!existing.weather.some(w => w.main === item.weather[0].main)) {
                existing.weather.push(item.weather[0]);
            }
        }
    });
    
    dayMap.forEach(day => dailyData.push(day));
    return dailyData.slice(0, 5);
}

// Updates the weather display with current data
function updateWeatherDisplay() {
    if (!weatherData) return;

    const windSpeedMS = weatherData.windSpeed;
    const windDir = weatherData.windDirection;
    const humidity = weatherData.humidity;

    highlightUpdate('humidity', `${humidity}%`);
    if (windDir && windSpeedMS) {
        highlightUpdate('wind',
            `${formatWindSpeed(windSpeedMS)} at ${Math.round(windDir)}°`);
    } else {
        highlightUpdate('wind', '--');
    }

    const wxUpdateTime = formatTime(new Date(), {
        hour: '2-digit',
        minute: '2-digit'
    });

    // Get station name
    const stationName = weatherData.stationName || '';

    // Update station information
    const stationInfoStr = stationName + ' @ ' + wxUpdateTime;
    highlightUpdate('station-info', stationInfoStr);
}

// Checks for hazardous weather in the upcoming forecast periods
export function checkWeatherHazards() {
    customLog('Checking for weather hazards in next forecast periods...');
    
    if (!forecastData || !Array.isArray(forecastData)) {
        customLog('No valid forecast data available for hazard check');
        return false;
    }
    
    // Log forecast data structure for debugging
    customLog(`Forecast data: ${forecastData.length} entries available`);
    
    // Take just the first n forecast entries
    const upcomingForecasts = forecastData.slice(0, 1);
    
    customLog(`Looking at ${upcomingForecasts.length} upcoming forecast periods`);
    
    // Check if any upcoming forecasts contain hazardous weather
    const hazardousWeatherTypes = ['Rain', 'Snow', 'Thunderstorm', 'Storm', 'Drizzle', 'Hail'];
    
    if (upcomingForecasts.length > 0) {
        // Log the upcoming forecasts for debugging
        upcomingForecasts.forEach((item, index) => {
            const time = new Date(item.dt * 1000).toLocaleTimeString();
            customLog(`Forecast ${index + 1} at ${time}: ${JSON.stringify(item.weather[0].main)}`);
        });
    }
    
    const hasHazardousWeather = upcomingForecasts.some(item => 
        item.weather && item.weather.some(w => 
            hazardousWeatherTypes.some(type => 
                w.main.includes(type) || w.description.toLowerCase().includes(type.toLowerCase())
            )
        )
    );
    
    // Get the weather section button
    const weatherButton = document.getElementById('wx-section');

    // Add or remove the warning notification
    if (hasHazardousWeather) {
        customLog('⚠️ WEATHER ALERT: Hazardous weather detected in upcoming forecast!');
        weatherButton.classList.add('weather-warning');
    } else {
        customLog('Weather check complete: No hazards detected in upcoming forecast');
        weatherButton.classList.remove('weather-warning');
    }
    
    return hasHazardousWeather;
}

// Fetches and updates the Air Quality Index (AQI)
function updateAQI(lat, lon, apiKey) {
    fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`)
        .then(response => response.json())
        .then(data => {
            const aqi = data.list[0].main.aqi;
            let aqiText = '';
            let color = '';

            switch (aqi) {
                case 1:
                    aqiText = 'Good';
                    color = 'green';
                    break;
                case 2:
                    aqiText = 'Fine';
                    color = 'lightgreen';
                    break;
                case 3:
                    aqiText = 'Moderate';
                    color = 'orange';
                    break;
                case 4:
                    aqiText = 'Poor';
                    color = 'orangered';
                    break;
                case 5:
                    aqiText = 'Very Poor';
                    color = 'red';
                    break;
                default:
                    aqiText = 'Unknown';
                    color = 'gray';
            }

            highlightUpdate('aqi', aqiText);
            document.getElementById('aqi-dot').style.backgroundColor = color;
        });
}

// Switches the weather image based on the type provided
window.switchWeatherImage = function (type) {
    const weatherImage = document.getElementById('weather-image');
    weatherImage.style.opacity = '0';
    
    setTimeout(() => {
        weatherImage.src = SAT_URLS[type];
        weatherImage.style.opacity = '1';
    }, 300);
    
    // Update buttons and slider position
    const weatherSwitch = document.querySelector('.weather-switch');
    const buttons = weatherSwitch.getElementsByTagName('button');
    buttons[0].classList.toggle('active', type === 'latest');
    buttons[1].classList.toggle('active', type === 'loop');
    buttons[2].classList.toggle('active', type === 'latest_ir');
    
    // Update slider position for three states
    const positions = { 'latest': 0, 'loop': 1, 'latest_ir': 2 };
    weatherSwitch.style.setProperty('--slider-position', positions[type]);
}

// Displays the hourly forecast for a specific day
window.showHourlyForecast = function (dayIndex) {
    // Logging
    customLog(`Showing hourly forecast for day index: ${dayIndex}`);

    if (!forecastData) {
        customLog('No forecast data available for hourly forecast!');
        return;
    }

    const startDate = new Date(forecastData[0].dt * 1000).setHours(0, 0, 0, 0);
    const targetDate = new Date(startDate + dayIndex * 24 * 60 * 60 * 1000);
    const endDate = new Date(targetDate).setHours(23, 59, 59, 999);

    const hourlyData = forecastData.filter(item => {
        const itemDate = new Date(item.dt * 1000);
        return itemDate >= targetDate && itemDate <= endDate;
    });

    const popupDate = document.getElementById('popup-date');
    popupDate.textContent = targetDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    const hourlyContainer = document.querySelector('.hourly-forecast');
    hourlyContainer.innerHTML = hourlyData.map(item => {
        const itemDate = new Date(item.dt * 1000);
        const time = formatTime(itemDate, {
            hour: 'numeric',
            minute: '2-digit'
        });
        
        // Get weather condition class
        const weatherCondition = item.weather[0].main.toLowerCase();
        
        return `
            <div class="hourly-item ${weatherCondition}">
                <div class="hourly-time">${time}</div>
                <img src="https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png" alt="${item.weather[0].description}" style="width: 50px; height: 50px;">
                <div class="hourly-temp">${formatTemperature(item.main.temp)}</div>
                <div class="hourly-desc">${item.weather[0].main}</div>
            </div>
        `;
    }).join('');

    document.querySelector('.overlay').classList.add('show');
    document.querySelector('.forecast-popup').classList.add('show');
}

// Closes the hourly forecast popup
window.closeHourlyForecast = function () {
    document.querySelector('.overlay').classList.remove('show');
    document.querySelector('.forecast-popup').classList.remove('show');
}

// Add click handler to close popup when clicking overlay
document.querySelector('.overlay').addEventListener('click', closeHourlyForecast);
