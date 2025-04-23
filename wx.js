// Import required functions from app.js
import { formatTime, highlightUpdate } from './common.js';
import { settings, turnOffDarkMode, turnOnDarkMode } from './settings.js';

// Parameters
const SAT_URLS = {
    latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/1250x750.jpg',
    loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif',
    latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/11/1250x750.jpg',
};

// Module variables
let forecastDataPrem = null; // has both current and forecast data
let weatherData = null;
let forecastData = null;
let moonPhaseData = null;
let sunrise = null;
let sunset = null;
let lastLat = null;
let lastLong = null;

// Add a variable to track the minutely chart instance
let minutelyPrecipChart = null;

// Export these variables for use in other modules
export { sunrise, sunset, weatherData, SAT_URLS };

// Automatically toggles dark mode based on sunrise and sunset times
export function autoDarkMode(lat, long) {
    // if lat or long are null, then replace with last known values
    if (lat == null || long == null) {
        if (lastLat && lastLong) {
            lat = lastLat;
            long = lastLong;
        } else {
            console.log('autoDarkMode: No coordinates available.');
            return;
        }
    }

    console.log('Auto dark mode check for coordinates: ', lat, long);
    if (!sunrise || !sunset) {
        console.log('autoDarkMode: sunrise/sunset data not available.');
        return;
    }

    if (settings && settings['auto-dark-mode']) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            console.log('Applying dark mode based on sunset...');
            turnOnDarkMode();
        } else {
            console.log('Applying light mode based on sunrise...');
            turnOffDarkMode();
        }
    } else {
        console.log('Auto dark mode disabled or coordinates not available.');
    }
}

// Fetches premium weather data from OpenWeather API
export function fetchPremiumWeatherData(lat, long, silentLoad = false) {
    console.log('Fetching premium weather data...');

    // Save so we can call functions later outside GPS update loop, if needed
    lastLat = lat;
    lastLong = long;

    // Show loading spinner, hide forecast container - only if not silent loading
    const forecastContainer = document.getElementById('prem-forecast-container');
    const loadingSpinner = document.getElementById('prem-forecast-loading');

    // Remember display style of forecast container
    let lastDisplayStyle = forecastContainer.style.display;
    if (!silentLoad) {
        if (forecastContainer) forecastContainer.style.display = 'none';
        if (loadingSpinner) loadingSpinner.style.display = 'flex';
    }

    // Fetch and update weather data (single fetch)
    fetch(`openwx_proxy.php/data/3.0/onecall?lat=${lat}&lon=${long}&units=imperial`)
        .then(response => response.json())
        .then(forecastDataLocal => {
            if (forecastDataLocal) {
                forecastDataPrem = forecastDataLocal;
                updatePremiumWeatherDisplay();
                // autoDarkMode(lat, long);
                // Update time and location of weather data, using FormatTime
                const weatherUpdateTime = formatTime(new Date(forecastDataLocal.current.dt * 1000), {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                // Get nearest city using OpenWeather GEOlocation API
                fetch(`openwx_proxy.php/geo/1.0/reverse?lat=${lat}&lon=${long}&limit=1`)
                    .then(response => response.json())
                    .then(data => {
                        if (data && data.length > 0) {
                            const city = data[0].name;
                            const state = data[0].state;
                            const country = data[0].country;
                            const stationStr = `${city}, ${state} @ ${weatherUpdateTime}`;
                            highlightUpdate('prem-station-info', stationStr);
                        } else {
                            console.log('No location data available.');
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching location data: ', error);
                    });
            } else {
                console.log('No premium forecast data available.');
                forecastDataPrem = null;
            }

            // if (lat && long) {
            //     updateAQI(lat, long);
            // }

            // Hide spinner and show forecast when data is loaded - only if not silent loading
            if (forecastContainer) forecastContainer.style.display = lastDisplayStyle;
            if (loadingSpinner) loadingSpinner.style.display = 'none';
        })
        .catch(error => {
            console.error('Error fetching forecast data: ', error);

            // In case of error, hide spinner and show error message - only if not silent loading
            if (!silentLoad) {
                if (loadingSpinner) loadingSpinner.style.display = 'none';
            }
        });
}

// Updates the forecast display with premium data
export function updatePremiumWeatherDisplay() {
    if (!forecastDataPrem) return;

    // Extract daily summary (first 5 days)
    const dailyData = extractPremiumDailyForecast(forecastDataPrem.daily || []);
    const forecastDays = document.querySelectorAll('#prem-forecast-container .forecast-day');

    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];

            // Update weather condition class
            const weatherCondition = day.weather[0].main.toLowerCase();
            dayElement.className = `forecast-day ${weatherCondition}`;

            // Update date
            const dateElement = dayElement.querySelector('.forecast-date');
            if (dateElement) {
                dateElement.textContent = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }

            // Update weather icon
            const iconElement = dayElement.querySelector('.forecast-icon');
            if (iconElement) {
                iconElement.src = `https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png`;
                iconElement.alt = day.weather[0].description;
            }

            // Update temperature
            const tempElement = dayElement.querySelector('.forecast-temp');
            if (tempElement) {
                tempElement.textContent = `${formatTemperature(day.temp.min)}/${formatTemperature(day.temp.max)}`;
            }

            // Update description
            const descElement = dayElement.querySelector('.forecast-desc');
            if (descElement) {
                descElement.textContent = day.weather[0].main;
            }

            // Show or hide hazard alert
            const alertIcon = dayElement.querySelector('.forecast-alert');
            if (premiumDayHasHazards(day)) {
                alertIcon.classList.remove('hidden');
            } else {
                alertIcon.classList.add('hidden');
            }

            // Attach click handler for precipitation graph
            // TODO: Should be done in HTML?
            dayElement.onclick = () => showPremiumPrecipGraph(index);
        }
    });

    // Update current conditions (from forecastDataPrem.current)
    if (forecastDataPrem.current) {
        const humidity = forecastDataPrem.current.humidity;
        const windSpeed = forecastDataPrem.current.wind_speed;
        const windDir = forecastDataPrem.current.wind_deg;
        highlightUpdate('prem-humidity', `${humidity}%`);
        if (windSpeed && windDir !== undefined) {
            highlightUpdate('prem-wind', `${formatWindSpeed(windSpeed)} at ${Math.round(windDir)}°`);
        } else {
            highlightUpdate('prem-wind', '--');
        }
    }

    // Update solar and moon data (from forecastDataPrem.daily[0])
    if (forecastDataPrem.daily && forecastDataPrem.daily[0]) {
        const today = forecastDataPrem.daily[0];
        const sunriseTime = formatTime(new Date(today.sunrise * 1000), { timeZoneName: 'short' });
        highlightUpdate('prem-sunrise', sunriseTime);
        const sunsetTime = formatTime(new Date(today.sunset * 1000), { timeZoneName: 'short' });
        highlightUpdate('prem-sunset', sunsetTime);
        if (today.moon_phase !== undefined) {
            const moonPhase = getMoonPhaseName(today.moon_phase);
            highlightUpdate('prem-moonphase', moonPhase);
            // Update the moon icon
            const moonIcon = document.getElementById('prem-moon-icon');
            if (moonIcon) {
                moonIcon.setAttribute('style', getMoonPhaseIcon(today.moon_phase));
            }
        }
    }

    // --- Minutely Precipitation Graph Logic ---
    const minutely = forecastDataPrem.minutely || [];
    let hasMinutelyPrecip = false;
    let precipData = [];
    let labels = [];

    if (minutely.length > 0) {
        // Only consider the next hour (60 min)
        precipData = minutely.slice(0, 60).map(m => m.precipitation || 0);
        labels = minutely.slice(0, 60).map(m => {
            const t = new Date(m.dt * 1000);
            return t.getMinutes().toString().padStart(2, '0');
        });
        hasMinutelyPrecip = precipData.some(val => val > 0);
    }

    const minutelyContainer = document.getElementById('minutely-precip-container');
    const minutelyChartCanvas = document.getElementById('minutely-precip-chart');
    const premWxSectionBtn = document.getElementById('prem-wx-section');

    if (hasMinutelyPrecip && minutelyContainer && minutelyChartCanvas) {
        minutelyContainer.style.display = '';
        // Show orange alert dot on section button
        premWxSectionBtn.classList.add('weather-warning');

        // Draw or update the chart
        if (minutelyPrecipChart) {
            minutelyPrecipChart.destroy();
        }
        minutelyPrecipChart = new Chart(minutelyChartCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Precipitation (mm/hr)',
                    data: precipData,
                    backgroundColor: 'rgba(255, 119, 0, 0.6)'
                }]
            },
            options: {
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { title: { display: true, text: 'Minute (next hour)' } },
                    y: { title: { display: true, text: 'Precipitation (mm/hr)' }, beginAtZero: true }
                }
            }
        });
    } else {
        // Hide the graph and remove alert dot
        if (minutelyContainer) minutelyContainer.style.display = 'none';
        if (premWxSectionBtn) premWxSectionBtn.classList.remove('weather-warning');
        if (minutelyPrecipChart) {
            minutelyPrecipChart.destroy();
            minutelyPrecipChart = null;
        }
    }

    // Hide spinner, show forecast
    const forecastContainer = document.getElementById('prem-forecast-container');
    const loadingSpinner = document.getElementById('prem-forecast-loading');
    if (forecastContainer) forecastContainer.classList.remove('hidden');
    if (loadingSpinner) loadingSpinner.style.display = 'none';
}

// Fetches weather data from the old OpenWeather API
export function fetchWeatherData(lat, long) {
    console.log('Fetching weather data...');

    // Save so we can call functions later outside GPS update loop, if needed
    lastLat = lat;
    lastLong = long;

    fetch(`https://secure.geonames.org/findNearByWeatherJSON?lat=${lat}&lng=${long}&username=birgefuller`)
        .then(response => response.json())
        .then(weatherDataLocal => {
            if (weatherDataLocal) {
                console.log('Current weather data: ', weatherDataLocal);
                // check to see if wind direction is NaN
                if (isNaN(weatherDataLocal.weatherObservation.windDirection)) {
                    weatherDataLocal.weatherObservation.windDirection = null;
                    weatherDataLocal.weatherObservation.windSpeed = null;
                } else {
                    // take the reciprocal of the wind direction to get the wind vector
                    weatherDataLocal.weatherObservation.windDirection =
                        (weatherDataLocal.weatherObservation.windDirection + 180) % 360;
                }
                weatherData = weatherDataLocal.weatherObservation;
                updateWeatherDisplay();
            }
        })
        .catch(error => {
            console.error('Error fetching weather data: ', error);

            // In case of error, hide spinner and show error message - only if not silent loading
            if (!silentLoad) {
                if (loadingSpinner) loadingSpinner.style.display = 'none';
            }
        });
}

// Fetches forecast data and updates the display
export function fetchForecastData(lat, long, silentLoad = false) {
    console.log('Fetching foercast data...' + (silentLoad ? ' (background load)' : ''));

    // Save so we can call functions later outside GPS update loop, if needed
    lastLat = lat;
    lastLong = long;

    // Show loading spinner, hide forecast container - only if not silent loading
    const forecastContainer = document.getElementById('forecast-container');
    const loadingSpinner = document.getElementById('forecast-loading');

    // Remember display style of forecast container
    let lastDisplayStyle = forecastContainer.style.display;
    if (!silentLoad) {
        if (forecastContainer) forecastContainer.style.display = 'none';
        if (loadingSpinner) loadingSpinner.style.display = 'flex';
    }

    // Fetch and update weather data
    const unixTime = Math.floor(Date.now() / 1000);
    Promise.all([
        fetch(`openwx_proxy.php/data/2.5/forecast?lat=${lat}&lon=${long}&units=imperial`),
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${unixTime}`)
    ])
        .then(([forecastResponse, sunResponse, moonResponse]) => Promise.all([
            forecastResponse.json(),
            sunResponse.json(),
            moonResponse.json()
        ]))
        .then(([forecastDataLocal, sunData, moonData]) => {
            if (forecastDataLocal && sunData && moonData) {
                sunrise = sunData.results.sunrise;
                sunset = sunData.results.sunset;
                moonPhaseData = moonData[0];
                forecastData = forecastDataLocal.list;
                updateForecastDisplay();
                autoDarkMode(lat, long);
            }

            updateAQI(lat, long);

            // Hide spinner and show forecast when data is loaded - only if not silent loading
            if (forecastContainer) forecastContainer.style.display = lastDisplayStyle;
            if (loadingSpinner) loadingSpinner.style.display = 'none';
        })
        .catch(error => {
            console.error('Error fetching forecast data: ', error);

            // In case of error, hide spinner and show error message - only if not silent loading
            if (!silentLoad) {
                if (loadingSpinner) loadingSpinner.style.display = 'none';
            }
        });
}

// Updates the forecast display with daily data
export function updateForecastDisplay() {
    if (!forecastData) return;

    const forecastDays = document.querySelectorAll('.forecast-day');
    const dailyData = extractDailyForecast(forecastData);

    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];

            // Update weather condition class
            const weatherCondition = day.weather[0].main.toLowerCase();
            dayElement.className = `forecast-day ${weatherCondition}`;

            // Update date
            const dateElement = dayElement.querySelector('.forecast-date');
            if (dateElement) {
                dateElement.textContent = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }

            // Update weather icon
            const iconElement = dayElement.querySelector('.forecast-icon');
            if (iconElement) {
                iconElement.src = `https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png`;
                iconElement.alt = day.weather[0].description;
            }

            // Update temperature
            const tempElement = dayElement.querySelector('.forecast-temp');
            if (tempElement) {
                tempElement.textContent = `${formatTemperature(day.temp_min)}/${formatTemperature(day.temp_max)}`;
            }

            // Update description
            const descElement = dayElement.querySelector('.forecast-desc');
            if (descElement) {
                descElement.textContent = day.weather[0].main;
            }

            // Show or hide hazard alert
            const alertIcon = dayElement.querySelector('.forecast-alert');
            if (dayHasHazards(day)) {
                alertIcon.classList.remove('hidden');
            } else {
                alertIcon.classList.add('hidden');
            }
        }
    });

    // After updating the forecast display, check for weather hazards
    checkWeatherHazards();

    // Update solar data
    if (!sunrise || !sunset) return;
    const sunriseTime = formatTime(new Date(sunrise), {
        timeZoneName: 'short'
    });
    highlightUpdate('sunrise', sunriseTime);
    const sunsetTime = formatTime(new Date(sunset), {
        timeZoneName: 'short'
    });
    highlightUpdate('sunset', sunsetTime);
    if (moonPhaseData) {
        const moonPhase = moonPhaseData.Phase;
        highlightUpdate('moonphase', moonPhase);
        // Update the moon icon
        const moonIcon = document.getElementById('moon-icon');
        if (moonIcon) {
            moonIcon.setAttribute('style', getMoonPhaseIcon(moonPhaseData.Illumination));
        }
    }
}

// Updates the weather display with current data
export function updateWeatherDisplay() {
    if (!weatherData) return;
    console.log('Updating weather display...');

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

// Check if premium forecast data has any hazards or rain in the next hour, checking both the hourly forecast and the minutely forecast, and setting the warning notification, if so, adding the warning notification to the prem-wx-section button
export function checkPremiumWeatherHazards() {
    console.log('Checking for premium weather hazards in next forecast periods...');

    if (!forecastDataPrem || !Array.isArray(forecastDataPrem)) {
        console.log('No valid premium forecast data available for hazard check');
        return false;
    }

    // Log forecast data structure for debugging
    console.log(`Premium forecast data: ${forecastDataPrem.length} entries available`);

    // Take just the first n forecast entries
    const upcomingForecasts = forecastDataPrem.hourly.slice(0, 1);

    console.log(`Looking at ${upcomingForecasts.length} upcoming premium forecast periods`);

    // Check if any upcoming forecasts contain hazardous weather
    const hazardousWeatherTypes = ['Rain', 'Snow', 'Thunderstorm', 'Storm', 'Drizzle', 'Hail'];

    if (upcomingForecasts.length > 0) {
        // Log the upcoming forecasts for debugging
        upcomingForecasts.forEach((item, index) => {
            const time = new Date(item.dt * 1000).toLocaleTimeString();
            console.log(`Premium Forecast ${index + 1} at ${time}: ${JSON.stringify(item.weather[0].main)}`);
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
    const weatherButton = document.getElementById('prem-wx-section');

    // Add or remove the warning notification
    if (hasHazardousWeather) {
        console.log('⚠️ PREMIUM WEATHER ALERT: Hazardous weather detected in upcoming forecast!');
        weatherButton.classList.add('weather-warning');
    } else {
        console.log('Premium weather check complete: No hazards detected in upcoming forecast');
        weatherButton.classList.remove('weather-warning');
    }

    return hasHazardousWeather;
}

// Checks for hazardous weather in the upcoming forecast periods
export function checkWeatherHazards() {
    console.log('Checking for weather hazards in next forecast periods...');
    
    if (!forecastData || !Array.isArray(forecastData)) {
        console.log('No valid forecast data available for hazard check');
        return false;
    }
    
    // Log forecast data structure for debugging
    console.log(`Forecast data: ${forecastData.length} entries available`);
    
    // Take just the first n forecast entries
    const upcomingForecasts = forecastData.slice(0, 1);
    
    console.log(`Looking at ${upcomingForecasts.length} upcoming forecast periods`);
    
    // Check if any upcoming forecasts contain hazardous weather
    const hazardousWeatherTypes = ['Rain', 'Snow', 'Thunderstorm', 'Storm', 'Drizzle', 'Hail'];
    
    if (upcomingForecasts.length > 0) {
        // Log the upcoming forecasts for debugging
        upcomingForecasts.forEach((item, index) => {
            const time = new Date(item.dt * 1000).toLocaleTimeString();
            console.log(`Forecast ${index + 1} at ${time}: ${JSON.stringify(item.weather[0].main)}`);
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
        console.log('⚠️ WEATHER ALERT: Hazardous weather detected in upcoming forecast!');
        weatherButton.classList.add('weather-warning');
    } else {
        console.log('Weather check complete: No hazards detected in upcoming forecast');
        weatherButton.classList.remove('weather-warning');
    }
    
    return hasHazardousWeather;
}

// Helper: Extract 5 daily summaries from OpenWeather 3.0 API
function extractPremiumDailyForecast(dailyList) {
    // dailyList is already daily summaries (up to 8 days)
    return dailyList.slice(0, 5);
}

// Consolidated: Format temperature based on user settings
function formatTemperature(tempF) {
    if (!settings || settings["imperial-units"]) {
        return Math.round(tempF) + "°";
    } else {
        // Convert F to C: (F - 32) * 5/9
        return Math.round((tempF - 32) * 5/9) + "°";
    }
}

// Consolidated: Format wind speed based on user settings
function formatWindSpeed(speedMS) {
    if (!settings || settings["imperial-units"]) {
        // Convert m/s to mph
        return Math.round(speedMS * 2.237) + " MPH";
    } else {
        // Keep as m/s
        return Math.round(speedMS) + " m/s";
    }
}

// Helper: Check for hazards in a premium daily forecast
function premiumDayHasHazards(day) {
    const hazardConditions = ['Rain', 'Snow', 'Sleet', 'Hail', 'Thunderstorm', 'Storm', 'Drizzle'];
    return day.weather.some(w =>
        hazardConditions.some(condition =>
            w.main.includes(condition) || w.description.toLowerCase().includes(condition.toLowerCase())
        )
    );
}

// Generate CSS styling for the moon phase icon based on phase value
function getMoonPhaseIcon(phase) {
    // Create CSS for the moon icon based on the phase value (0 to 1)
    // 0 = new moon (fully dark), 0.5 = full moon (fully light), 1 = new moon again
    let style = '';
    if (phase === 0 || phase === 1) {
        // New moon - completely dark circle
        style = 'background-color: #000;';
    } else if (phase === 0.5) {
        // Full moon - completely light circle
        style = 'background-color: #fff; box-shadow: inset 0 0 4px rgba(0,0,0,0.2);';
    } else if (phase < 0.5) {
        // Waxing moon - illuminated from right
        const percentageVisible = phase * 2; // 0 to 1
        style = `background-color: #000;
                 box-shadow: inset ${12 * percentageVisible}px 0 0 0 #fff;`;
    } else {
        // Waning moon - illuminated from left
        const percentageVisible = (1 - phase) * 2; // 1 to 0
        style = `background-color: #000;
                 box-shadow: inset -${12 * percentageVisible}px 0 0 0 #fff;`;
    }
    return style;
}

// Return string description of the closest moon phase
function getMoonPhaseName(phase) {
    if (phase < 0.05) {
        return 'New';
    } else if (phase < 0.35) {
        return 'Crescent';
    } else if (phase < 0.65) {
        return 'Quarter';
    } else if (phase < 0.95) {
        return 'Gibbous';
    } else {
        return 'Full Moon';
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

// Summarizes forecast data for each day
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

// Fetches and updates the Air Quality Index (AQI) from openweather.org
function updateAQI(lat, lon) {
    fetch(`openwx_proxy.php/data/2.5/air_pollution?lat=${lat}&lon=${lon}`)
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

            highlightUpdate('prem-aqi', aqiText);
            document.getElementById('prem-aqi-dot').style.backgroundColor = color;
        });
}

// Show precipitation graph for a premium forecast day
window.showPremiumPrecipGraph = function(dayIndex) {
    if (!forecastDataPrem) return;

    const daily = forecastDataPrem.daily || [];
    const hourly = forecastDataPrem.hourly || [];

    if (!daily[dayIndex]) return;

    // Show only the premium overlay/popup
    const premOverlay = document.querySelector('#prem-weather .overlay');
    const premPopup = document.querySelector('#prem-weather .forecast-popup');
    if (premOverlay && premPopup) {
        premOverlay.classList.add('show');
        premPopup.classList.add('show');
    }

    // Calculate start/end of the selected day in local time
    const selectedDate = new Date(daily[dayIndex].dt * 1000);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Set popup title with local date
    const popupDate = premPopup.querySelector('#popup-date');
    if (popupDate) {
        popupDate.textContent = selectedDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }

    // Check if we're beyond the hourly forecast limit (48 hours)
    const now = new Date();
    const hoursDiff = (dayStart - now) / (1000 * 60 * 60);
    const hourlyContainer = premPopup.querySelector('.hourly-forecast');

    if (hoursDiff >= 48) {
        // Beyond hourly forecast limit - show message
        hourlyContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 20px;">
                <p>Detailed hourly forecast is only available for the next 48 hours.</p>
                <p>Daily forecast summary for ${selectedDate.toLocaleDateString('en-US', {weekday: 'long'})}:</p>
                <div class="hourly-item ${daily[dayIndex].weather[0].main.toLowerCase()}" style="margin-top: 15px;">
                    <img src="https://openweathermap.org/img/wn/${daily[dayIndex].weather[0].icon}@2x.png" 
                         alt="${daily[dayIndex].weather[0].description}" 
                         style="width: 50px; height: 50px;">
                    <div class="hourly-temp">${formatTemperature(daily[dayIndex].temp.min)}/${formatTemperature(daily[dayIndex].temp.max)}</div>
                    <div class="hourly-desc">${daily[dayIndex].weather[0].main}</div>
                </div>
            </div>`;
        return;
    }

    // Filter hourly data for the selected day using local time comparison
    const dayHourly = hourly.filter(h => {
        const itemDate = new Date(h.dt * 1000);
        return itemDate >= dayStart && itemDate <= dayEnd;
    });

    // Take every 3rd hour
    const threeHourData = dayHourly.filter((_, index) => index % 3 === 0);

    // Update popup content
    if (hourlyContainer) {
        hourlyContainer.innerHTML = threeHourData.map(item => {
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
                    <div class="hourly-temp">${formatTemperature(item.temp)}</div>
                    <div class="hourly-desc">${item.weather[0].main}</div>
                </div>
            `;
        }).join('');
    }
};

// Premium popup close handler
window.closePremiumPrecipPopup = function() {
    const premOverlay = document.querySelector('#prem-weather .overlay');
    const premPopup = document.querySelector('#prem-weather .forecast-popup');
    if (premOverlay) premOverlay.classList.remove('show');
    if (premPopup) premPopup.classList.remove('show');
    if (window.premiumPrecipChart) {
        window.premiumPrecipChart.destroy();
        window.premiumPrecipChart = null;
    }
}

// Displays the hourly forecast for a specific day
window.showHourlyForecast = function (dayIndex) {
    // Logging
    console.log(`Showing hourly forecast for day index: ${dayIndex}`);

    if (!forecastData) {
        console.log('No forecast data available for hourly forecast!');
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
