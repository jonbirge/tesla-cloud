// Import required functions from app.js
import { formatTime, highlightUpdate, testMode, isTestMode, showNotification, showWeatherAlertModal, usingIPLocation } from './common.js';
import { autoDarkMode, settings } from './settings.js';

// Parameters
const HOURLY_FORECAST_DAYS = 2;
const HOURLY_POPUP_GAP = 64; // px spacing between daily cards and hourly popup
const EUROPE_COUNTRIES = new Set([
    'AL', 'AD', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
    'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MD', 'ME',
    'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA'
]);

const SATELLITE_SOURCES = {
    conus: {
        label: 'U.S. (CONUS)',
        countries: ['US'],
        urls: {
            latest: 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/1250x750.jpg',
            loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif',
            latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/11/1250x750.jpg',
        },
        availability: { latest: true, loop: true, latest_ir: true },
    },
    mexico: {
        label: 'Mexico',
        countries: ['MX'],
        urls: {
            latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/MEX/GEOCOLOR/1250x750.jpg',
            latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/MEX/11/1250x750.jpg',
        },
        availability: { latest: true, loop: false, latest_ir: true },
    },
    canada: {
        label: 'Canada',
        countries: ['CA'],
        urls: {
            latest: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/NAM/GEOCOLOR/1250x750.jpg',
            latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/NAM/11/1250x750.jpg',
        },
        availability: { latest: true, loop: false, latest_ir: true },
    },
    china: {
        label: 'China & W. Pacific',
        countries: ['CN'],
        urls: {
            latest: 'https://slider.cira.colostate.edu/data/obs/himawari/full_disk/geocolor/latest.jpg',
        },
        availability: { latest: true, loop: false, latest_ir: false },
    },
    europe: {
        label: 'Europe',
        countries: [],
        urls: {
            latest: 'https://slider.cira.colostate.edu/data/obs/meteosat-11/full_disk/geocolor/latest.jpg',
        },
        availability: { latest: true, loop: false, latest_ir: false },
    },
};

// Module variables
let forecastDataPrem = null;            // Has both current and forecast data
let lastLat = null;
let lastLong = null;
let minutelyPrecipChart = null;
let precipGraphUpdateInterval = null;   // Timer for updating the precipitation graph
let currentRainAlert = false;           // Flag to track if we're currently under a rain alert
let currentWeatherAlerts = [];          // Array to store current weather alerts
let lastAlertCheck = 0;                 // Timestamp of last alert check to avoid duplicate popups
let city = null;                        // Variable to store the city name
let state = null;                       // Variable to store the state name
let country = null;                     // Variable to store the country name
let inCONUS = null;                     // In the continental US (CONUS)
let satellitePreference = 'conus';      // Preferred manual satellite source
let satelliteAutoMode = true;           // Whether to auto-select based on location
let activeSatelliteKey = 'conus';       // Currently selected source key
let currentSatelliteType = 'latest';    // Currently displayed imagery type

// Export these variables for use in other modules
export { SATELLITE_SOURCES, forecastDataPrem, lastLat, lastLong, city, state, currentRainAlert, currentWeatherAlerts };

// Determine which satellite source should be used for a country code
function findSatelliteSourceForCountry(countryCode) {
    if (!countryCode) return null;

    if (countryCode === 'US') return 'conus';
    if (countryCode === 'MX') return 'mexico';
    if (countryCode === 'CA') return 'canada';
    if (countryCode === 'CN') return 'china';
    if (EUROPE_COUNTRIES.has(countryCode)) return 'europe';

    return null;
}

function getActiveSatelliteSource() {
    return SATELLITE_SOURCES[activeSatelliteKey] || SATELLITE_SOURCES.conus;
}

function getFirstAvailableType(sourceKey = activeSatelliteKey) {
    const source = SATELLITE_SOURCES[sourceKey];
    if (!source) return 'latest';

    return Object.keys(source.availability).find(type => source.availability[type]) || 'latest';
}

function getSatelliteUrl(type) {
    const source = getActiveSatelliteSource();
    return source.urls[type] || null;
}

function updateSatelliteControls() {
    const weatherSwitch = document.querySelector('.weather-switch');
    if (!weatherSwitch) return;

    const typeOrder = ['latest', 'loop', 'latest_ir'];
    const source = getActiveSatelliteSource();

    weatherSwitch.style.setProperty('--slider-position', typeOrder.indexOf(currentSatelliteType));

    const buttons = weatherSwitch.querySelectorAll('button');
    buttons.forEach((btn, idx) => {
        const type = typeOrder[idx];
        const available = !!source.availability[type];
        btn.disabled = !available;
        btn.classList.toggle('unavailable', !available);
    });
}

function setActiveSatelliteSource(sourceKey, resetType = false) {
    const validatedKey = SATELLITE_SOURCES[sourceKey] ? sourceKey : 'conus';
    const didChange = validatedKey !== activeSatelliteKey;
    activeSatelliteKey = validatedKey;

    if (resetType || !getActiveSatelliteSource().availability[currentSatelliteType]) {
        currentSatelliteType = getFirstAvailableType(validatedKey);
    }

    updateSatelliteControls();

    const weatherImage = document.getElementById('weather-image');
    if (weatherImage) {
        const targetType = didChange ? currentSatelliteType : currentSatelliteType;
        const newUrl = getSatelliteUrl(targetType);
        if (newUrl) {
            weatherImage.src = newUrl;
        }
    }

    updateSatelliteHint();
}

function updateSatelliteHint() {
    const hint = document.getElementById('satellite-region-hint');
    const autoButton = document.getElementById('satellite-location-button');

    if (hint) {
        const source = getActiveSatelliteSource();
        const locationNote = country ? ` for ${country}` : '';
        const mode = satelliteAutoMode ? 'auto-selected' : 'manual';
        hint.textContent = `Showing ${source.label} (${mode}${locationNote})`;
    }

    if (autoButton) {
        autoButton.textContent = satelliteAutoMode ? 'Stop using current location' : 'Use current location';
    }
}

function applySatelliteSelection() {
    const locationKey = findSatelliteSourceForCountry(country);
    const targetKey = (satelliteAutoMode && locationKey) ? locationKey : satellitePreference;
    setActiveSatelliteSource(targetKey, true);
}

export function applySatelliteSettings(regionKey, autoMode = satelliteAutoMode) {
    if (regionKey && SATELLITE_SOURCES[regionKey]) {
        satellitePreference = regionKey;
    }
    satelliteAutoMode = autoMode;
    applySatelliteSelection();
}

// Fetches premium weather data from OpenWeather API
export async function fetchPremiumWeatherData(lat, long, silentLoad = false) {
	// console.log('fetchPremiumWeatherData()');

    // Save so we can call functions later outside GPS update loop, if needed
    lastLat = lat;
    lastLong = long;

    // Update city and state based on new coordinates
    await fetchCityData(lat, long);

    // Show loading state on forecast container when not silent loading
    if (!silentLoad) {
        document.getElementById('prem-forecast-container').classList.add('loading');
    }

    // Fetch both OneCall API (for current, hourly, minutely) and 5-day forecast API (for extended forecast)
    const oneCallPromise = fetch(`php/openwx.php/data/3.0/onecall?lat=${lat}&lon=${long}&units=imperial`)
        .then(response => response.json());
    
    const forecastPromise = fetch(`php/openwx.php/data/2.5/forecast?lat=${lat}&lon=${long}&units=imperial`)
        .then(response => response.json());

    Promise.all([oneCallPromise, forecastPromise])
        .then(([oneCallData, forecastData]) => {
            if (oneCallData) {
                // Start with OneCall data as the base
                forecastDataPrem = oneCallData;
                
                // Merge the 5-day forecast data for extended forecasts
                if (forecastData && forecastData.list) {
                    forecastDataPrem = mergeForecastData(oneCallData, forecastData);
                }
                
                // If in test mode for weather, generate random precipitation data for minutely forecast
                if (isTestMode('wx')) {
                    console.log('TEST MODE (wx): Generating random precipitation data');
                    generateTestMinutelyData(forecastDataPrem);
                }
                
                // If in test mode for alerts, add test weather alerts
                if (isTestMode('alert')) {
                    console.log('TEST MODE (alert): Adding test weather alerts');
                    generateTestWeatherAlerts(forecastDataPrem);
                    // Process test alerts immediately
                    processWeatherAlerts(forecastDataPrem);
                } // test mode
                
                updatePremiumWeatherDisplay();

                // Process weather alerts from API response
                processWeatherAlerts(oneCallData);

                // Update time and location of weather data, using FormatTime
                const weatherUpdateTime = formatTime(new Date(oneCallData.current.dt * 1000), {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // Update station info robustly
                if (isTestMode('wx') || isTestMode('alert')) {
                    const stationStr = `TEST WX @ ${weatherUpdateTime}`;
                    highlightUpdate('prem-station-info', stationStr);
                } else if (city && state) {
                    // Add "(Approximate)" indicator if using IP-based location
                    const approximateStr = usingIPLocation ? ' (Approximate)' : '';
                    const stationStr = `${city}, ${state}${approximateStr} @ ${weatherUpdateTime}`;
                    highlightUpdate('prem-station-info', stationStr);
                } else {
                    const stationStr = `${weatherUpdateTime}`;
                    highlightUpdate('prem-station-info', stationStr);
                }

                // Start auto-refresh for precipitation graph
                startPrecipGraphAutoRefresh();
            } else {
                console.log('No premium forecast data available.');
                forecastDataPrem = null;
            }

            if (lat && long) {
                updateAQI(lat, long);
            }

            // Remove loading state when data is loaded - only if not silent loading
            if (!silentLoad) {
                document.getElementById('prem-forecast-container').classList.remove('loading');
            }

            // Update auto-dark mode if enabled
            autoDarkMode(lat, long);
        })
        .catch(error => {
            console.error('Error fetching forecast data: ', error);

            // In test mode, create dummy forecast data for testing
            if (isTestMode('alert') || isTestMode('wx')) {
                console.log('TEST MODE: API failed, creating dummy forecast data');
                forecastDataPrem = {
                    current: { dt: Math.floor(Date.now() / 1000), temp: 32 },
                    daily: [],
                    hourly: [],
                    minutely: []
                };
                generateTestDailyForecast(forecastDataPrem);
                generateTestHourlyForecast(forecastDataPrem); // Add test hourly data
                
                // Only generate alerts and show them if alert test mode is active
                if (isTestMode('alert')) {
                    generateTestWeatherAlerts(forecastDataPrem);
                    processWeatherAlerts(forecastDataPrem);
                    updateWeatherAlertIndicator();
                    updateWeatherAlertsDisplay(); // Make sure to show alerts in weather section
                }
                
                updatePremiumWeatherDisplay(); // Update the display with test data
            }

            // In case of error, remove loading state - only if not silent loading
            if (!silentLoad) {
                document.getElementById('prem-forecast-container').classList.remove('loading');
            }
        });
}

// Fetch city data based on latitude and longitude
export async function fetchCityData(lat, long) {
	// console.log('fetchCityData()');

    try {
        const response = await fetch(`php/openwx.php/geo/1.0/reverse?lat=${lat}&lon=${long}&limit=1`);
        const data = await response.json();
        
        if (data && data.length > 0) {
            city = data[0].name;
            state = data[0].state;
            country = data[0].country;
            // Check if we're in the US but NOT in Hawaii or Alaska
            inCONUS = (country === 'US' && state !== 'HI' && state !== 'AK');

            // Update the location display
            highlightUpdate('city', city);
            highlightUpdate('state', state);

            // Always show the satellite section when location is available
            const satSection = document.getElementById('sat-section');
            if (satSection) {
                satSection.classList.remove('hidden');
            }

            applySatelliteSelection();
        } else {
            console.log('No location data available.');
        }
    } catch (error) {
        console.error('Error fetching location data: ', error);
    }
}

// Generate forecast day elements dynamically
export function generateForecastDayElements(numDays = 5) {
	// console.log('generateForecastDayElements()');

    const forecastContainer = document.getElementById('prem-forecast-container');
    if (!forecastContainer) return;

    // Clear existing forecast days
    forecastContainer.innerHTML = '';

    // Generate the specified number of forecast day elements
    for (let i = 0; i < numDays; i++) {
        const dayElement = document.createElement('div');
        dayElement.className = 'forecast-day';
        
        // Create the inner structure
        dayElement.innerHTML = `
            <div class="forecast-date"></div>
            <img class="forecast-icon" src="assets/placeholder.svg" alt="Loading icon">
            <div class="forecast-temp">--</div>
            <div class="forecast-desc"></div>
            <img class="forecast-alert hidden" src="assets/warn.svg" alt="Warning Icon">
        `;
        
        forecastContainer.appendChild(dayElement);
    }
}

// Updates the forecast display with premium data
export function updatePremiumWeatherDisplay() {
	// console.log('updatePremiumWeatherDisplay()');

    if (!forecastDataPrem) return;

    // Extract daily summary (limit to 5 days)
    const dailyData = extractPremiumDailyForecast(forecastDataPrem.daily || []);
    
    // Generate forecast day elements if they don't exist or if count is wrong
    const existingDays = document.querySelectorAll('#prem-forecast-container .forecast-day');
    if (existingDays.length !== 5) {
        generateForecastDayElements(5);
    }
    
    const forecastDays = document.querySelectorAll('#prem-forecast-container .forecast-day');

    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            // All 5 days are now clickable for hourly/3-hourly forecasts
            const hourlyAvail = index < 5 ? true : false;

            // Update weather condition class - always use "clear" as baseline for consistent background
            const baseWeatherClass = 'clear';
            const hourlyClass = hourlyAvail ? 'hourly-avail' : '';
            dayElement.className = `forecast-day ${hourlyClass} ${baseWeatherClass}`;

            // Clear any existing hourly segments
            const existingSegments = dayElement.querySelector('.hourly-segments');
            if (existingSegments) {
                existingSegments.remove();
            }

            // Add hourly segments for ALL days if enabled using complete 24-hour data
            if (settings["show-hourly-stripes"] !== false && index < 5) {
                const hourlySegments = createHourlySegments(day, forecastDataPrem.hourly || [], index);
                if (hourlySegments) {
                    dayElement.appendChild(hourlySegments);
                }
            }

            // Update date
            const dateElement = dayElement.querySelector('.forecast-date');
            if (dateElement) {
                // Split the date into weekday and month/day and render on two lines
                const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                dateElement.innerHTML = `${weekday}<br>${monthDay}`;
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

            // Attach click handler for hourly/3-hourly popup for all 5 days
            if (hourlyAvail) {
                dayElement.onclick = (event) => {
                    event.stopPropagation();
                    showPremiumPrecipGraph(index);
                };
            }
        }
    });

    // Update current conditions (from forecastDataPrem.current)
    if (forecastDataPrem.current) {
        const humidity = forecastDataPrem.current.humidity;
        const windSpeed = forecastDataPrem.current.wind_speed;
        const windGust = forecastDataPrem.current.wind_gust;
        const windDir = forecastDataPrem.current.wind_deg;
        highlightUpdate('prem-humidity', `${humidity}%`);
        if (windSpeed && windDir !== undefined) {
            const windText = `${formatWindSpeedRange(windSpeed, windGust)} @ ${Math.round(windDir)}°`;
            highlightUpdate('prem-wind', windText);
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
    
    // Ensure forecast is visible and remove loading state
    const forecastContainer = document.getElementById('prem-forecast-container');
    if (forecastContainer) forecastContainer.classList.remove('loading');

    // Update precipitation graph with time-based x-axis
    updatePrecipitationGraph();

    // Update weather alerts display
    updateWeatherAlertsDisplay();
}

// Update weather alerts display in the weather section
function updateWeatherAlertsDisplay() {
	// console.log('updateWeatherAlertsDisplay()');

    // Find or create alerts container
    let alertsContainer = document.getElementById('weather-alerts-container');
    if (!alertsContainer) {
        alertsContainer = document.createElement('div');
        alertsContainer.id = 'weather-alerts-container';
        alertsContainer.style.cssText = `
            margin: 16px 0;
            padding: 0;
        `;
        
        // Insert after the forecast container
        const forecastContainer = document.getElementById('prem-forecast-container');
        if (forecastContainer && forecastContainer.parentNode) {
            forecastContainer.parentNode.insertBefore(alertsContainer, forecastContainer.nextSibling);
        }
    }

    // Clear existing alerts
    alertsContainer.innerHTML = '';

    // Show current active alerts
    if (currentWeatherAlerts.length > 0) {
        const alertsTitle = document.createElement('h2');
        alertsTitle.textContent = 'Active Weather Alerts';
        // Use the same style as other headings like "Extended Forecast"
        alertsContainer.appendChild(alertsTitle);

        currentWeatherAlerts.forEach(alert => {
            const alertItem = document.createElement('div');
            alertItem.style.cssText = `
                background-color: rgba(255, 0, 0, 0.1);
                border: 1px solid #ff0000;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 8px;
            `;

            const alertHeader = document.createElement('div');
            alertHeader.style.cssText = `
                display: flex;
                align-items: center;
                margin-bottom: 8px;
            `;

            const alertIcon = document.createElement('span');
            alertIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #ff0000;">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            `;
            alertIcon.style.cssText = `
                display: inline-flex;
                align-items: center;
                margin-right: 8px;
            `;

            const alertTitle = document.createElement('strong');
            alertTitle.textContent = alert.event || 'Weather Alert';
            alertTitle.style.cssText = `
                color: #ff0000;
                font-size: 16px;
            `;

            alertHeader.appendChild(alertIcon);
            alertHeader.appendChild(alertTitle);

            const alertDescription = document.createElement('p');
            alertDescription.textContent = alert.description || 'Weather alert in effect.';
            alertDescription.style.cssText = `
                margin: 0 0 8px 0;
                line-height: 1.3;
                color: var(--button-text);
                font-style: italic;
            `;

            const alertTime = document.createElement('div');
            alertTime.style.cssText = `
                font-size: 12px;
                color: var(--text-color);
            `;
            const endTime = new Date(alert.end * 1000).toLocaleString();
            alertTime.textContent = `Until: ${endTime}`;

            alertItem.appendChild(alertHeader);
            alertItem.appendChild(alertDescription);
            alertItem.appendChild(alertTime);
            alertsContainer.appendChild(alertItem);
        });
    }
}

// Helper function to create hourly segments for a forecast day
function createHourlySegments(dailyForecast, completeHourlyData, dayIndex) {
	// console.log('createHourlySegments()');

    // Calculate start/end of the day in local time
    const selectedDate = new Date(dailyForecast.dt * 1000);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);
    
    const now = new Date();
    const isToday = now.toDateString() === selectedDate.toDateString();
    
    // Extract the complete 24-hour data for this specific day
    const dayHourlyComplete = completeHourlyData.filter(h => {
        const itemDate = new Date(h.dt * 1000);
        return itemDate >= dayStart && itemDate <= dayEnd;
    });

    if (dayHourlyComplete.length === 0) {
        return null; // No hourly data available for this day
    }

    // Create the hourly segments container
    const segmentsContainer = document.createElement('div');
    segmentsContainer.className = 'hourly-segments';
    
    // Get starting hour - if today, start from current hour, otherwise start from 0
    const startHour = isToday ? now.getHours() : 0;
    const hoursToShow = 24 - startHour;
    
    // Set consistent background - always use "clear" as baseline
    const baseCondition = 'clear';
    
    // Create segments for remaining hours (or all hours for future days)
    for (let h = 0; h < hoursToShow; h++) {
        const hour = startHour + h;
        const segment = document.createElement('div');
        segment.className = 'hourly-segment';
        
        // Find the hourly data for this specific hour
        const hourData = dayHourlyComplete.find(h => {
            const itemDate = new Date(h.dt * 1000);
            return itemDate.getHours() === hour;
        });

        if (hourData) {
            // Apply weather condition class based on hourly data
            const weatherCondition = hourData.weather[0].main.toLowerCase();
            
            // Only show stripe if weather condition is different from clear/baseline
            if (weatherCondition !== baseCondition && weatherCondition !== 'clear') {
                segment.classList.add(weatherCondition);
            } else {
                // Make transparent to show card background
                segment.style.background = 'transparent';
            }
        } else {
            // No hourly data - make transparent to show card background
            segment.style.background = 'transparent';
        }

        segmentsContainer.appendChild(segment);
    }

    return segmentsContainer;
}

// Create complete 24-hour data structure for all 5 days
function createComplete24HourData(oneCallData, forecastData) {
	// console.log('createComplete24HourData()');

    const complete24HourData = [];
    const nowTimestamp = Math.floor(Date.now() / 1000);
    
    // Get all unique days we need to cover (5 days total)
    const targetDays = [];
    for (let i = 0; i < 5; i++) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + i);
        targetDate.setHours(0, 0, 0, 0);
        targetDays.push({
            date: targetDate,
            timestamp: Math.floor(targetDate.getTime() / 1000)
        });
    }
    
    // For each day, create complete 24-hour hourly data
    targetDays.forEach((day, dayIndex) => {
        const dayStart = day.timestamp;
        const dayEnd = dayStart + (24 * 3600) - 1;
        
        // For each hour of the day
        for (let hour = 0; hour < 24; hour++) {
            const hourTimestamp = dayStart + (hour * 3600);
            
            // Skip past hours for today
            if (dayIndex === 0 && hourTimestamp < nowTimestamp) {
                continue;
            }
            
            let hourlyDataPoint = null;
            
            // Days 1-2: Use OneCall hourly data (high resolution)
            if (dayIndex < 2 && oneCallData.hourly) {
                hourlyDataPoint = oneCallData.hourly.find(h => 
                    Math.abs(h.dt - hourTimestamp) < 1800 // Within 30 minutes
                );
            }
            
            // Days 3-5 or fallback: Use 5-day forecast data (3-hourly, need interpolation)
            if (!hourlyDataPoint && forecastData && forecastData.list) {
                // Find closest 3-hourly data point
                let closestForecastItem = null;
                let minTimeDiff = Infinity;
                
                for (const item of forecastData.list) {
                    const timeDiff = Math.abs(item.dt - hourTimestamp);
                    if (timeDiff < minTimeDiff) {
                        minTimeDiff = timeDiff;
                        closestForecastItem = item;
                    }
                }
                
                if (closestForecastItem) {
                    // Convert 5-day forecast format to hourly format
                    hourlyDataPoint = {
                        dt: hourTimestamp,
                        temp: closestForecastItem.main.temp,
                        feels_like: closestForecastItem.main.feels_like,
                        pressure: closestForecastItem.main.pressure,
                        humidity: closestForecastItem.main.humidity,
                        dew_point: closestForecastItem.main.temp - ((100 - closestForecastItem.main.humidity) / 5),
                        uvi: 0,
                        clouds: closestForecastItem.clouds.all,
                        visibility: closestForecastItem.visibility || 10000,
                        wind_speed: closestForecastItem.wind.speed,
                        wind_deg: closestForecastItem.wind.deg,
                        wind_gust: closestForecastItem.wind.gust || closestForecastItem.wind.speed,
                        weather: closestForecastItem.weather,
                        pop: closestForecastItem.pop || 0
                    };
                }
            }
            
            if (hourlyDataPoint) {
                complete24HourData.push(hourlyDataPoint);
            }
        }
    });
    
    console.log(`Created complete 24-hour data: ${complete24HourData.length} hourly points`);
    return complete24HourData;
}

// Interpolate hourly segments from 3-hourly data for days 3-5
function interpolateHourlyFromThreeHourly(threeHourlyData, dailyForecast) {
	// console.log('interpolateHourlyFromThreeHourly()');

    const interpolatedHourlyData = [];
    const dayStart = new Date(dailyForecast.dt * 1000);
    dayStart.setHours(0, 0, 0, 0);
    
    // Create hourly data points for the entire day
    for (let hour = 0; hour < 24; hour++) {
        const hourTimestamp = new Date(dayStart);
        hourTimestamp.setHours(hour);
        const hourUnixTime = Math.floor(hourTimestamp.getTime() / 1000);
        
        // Find the closest 3-hourly data point
        let closestData = threeHourlyData[0]; // Default fallback
        let minTimeDiff = Math.abs(threeHourlyData[0].dt - hourUnixTime);
        
        for (const data of threeHourlyData) {
            const timeDiff = Math.abs(data.dt - hourUnixTime);
            if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestData = data;
            }
        }
        
        // Create interpolated hourly data point using the closest 3-hourly data
        interpolatedHourlyData.push({
            dt: hourUnixTime,
            temp: closestData.temp,
            feels_like: closestData.feels_like,
            pressure: closestData.pressure,
            humidity: closestData.humidity,
            dew_point: closestData.dew_point,
            uvi: closestData.uvi,
            clouds: closestData.clouds,
            visibility: closestData.visibility,
            wind_speed: closestData.wind_speed,
            wind_deg: closestData.wind_deg,
            wind_gust: closestData.wind_gust,
            weather: closestData.weather,
            pop: closestData.pop
        });
    }
    
    return interpolatedHourlyData;
}

// Function to update precipitation graph with current time-based x-axis
function updatePrecipitationGraph() {
	// console.log('updatePrecipitationGraph()');

    if (!forecastDataPrem || !forecastDataPrem.minutely) return;

    const minutely = forecastDataPrem.minutely || [];
    let hasMinutelyPrecip = false;

    if (minutely.length > 0) {
        const currentTime = new Date();
        console.log(`Updating precipitation graph at: ${currentTime.toLocaleTimeString()}`);

        // Calculate time offsets relative to now and filter out past times
        const precipData = minutely.map(m => {
            const minuteTime = new Date(m.dt * 1000);
            const timeDiffMinutes = Math.round((minuteTime - currentTime) / (60 * 1000));

            return {
                x: timeDiffMinutes,
                y: m.precipitation || 0,
                time: minuteTime
            };
        }).filter(item => item.x >= 0); // Filter out past times

        // Check for rain in the next 15 minutes and show alert if detected
        checkImminentRain(minutely);

        // Extract data for chart
        const labels = precipData.map(item => item.x);
        const values = precipData.map(item => item.y);

        // Handle rain if any precipitation values are finite
        hasMinutelyPrecip = values.some(val => val > 0);
        const minutelyContainer = document.getElementById('minutely-precip-container');
        const minutelyChartCanvas = document.getElementById('minutely-precip-chart');
        
        if (hasMinutelyPrecip) {
            minutelyContainer.style.display = ''; // Show the graph container

            if (minutelyPrecipChart) {
                // Enhanced animated update for existing chart
                updateChartWithAnimation(minutelyPrecipChart, labels, values);
            } else {
                // Create new chart if it doesn't exist
                minutelyPrecipChart = new Chart(minutelyChartCanvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Precipitation (mm/hr)',
                            data: values,
                            backgroundColor: 'rgba(255, 119, 0, 0.6)'
                        }]
                    },
                    options: {
                        plugins: {
                            legend: { display: false }
                        },
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: 'Minutes from now',
                                    font: {
                                        size: 18,
                                        weight: 600
                                    }
                                },
                                ticks: {
                                    font: {
                                        size: 16
                                    },
                                    callback: function (value) {
                                        return "+" + value;
                                    }
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Precipitation (mm/hr)',
                                    font: {
                                        size: 18,
                                        weight: 600
                                    }
                                },
                                beginAtZero: true,
                                ticks: {
                                    font: {
                                        size: 16
                                    }
                                }
                            }
                        },
                        animation: {
                            duration: 200 // Fast animation for updates
                        }
                    }
                });
            }
        } else { // No precipitation found
            // Hide the graph
            if (minutelyContainer) minutelyContainer.style.display = 'none';
            if (minutelyPrecipChart) {
                minutelyPrecipChart.destroy();
                minutelyPrecipChart = null;
            }
            console.log('No precipitation data to display; continuing to monitor.');
        }
    } else { // No minutely data available
        // Hide the rain indicator
        toggleRainIndicator(false);
        console.log('No minutely precipitation data available; continuing to monitor.');
    }
    // Update axis colors based on theme
    updateRainChartAxisColors();
}

// Function to update the axis colors of the rain chart
export function updateRainChartAxisColors() {
	// console.log('updateRainChartAxisColors()');

    // Get computed values from body element instead of document.documentElement
    const computedStyle = getComputedStyle(document.body);
    const axisColor = computedStyle.getPropertyValue('--text-color').trim();
    const gridColor = computedStyle.getPropertyValue('--separator-color').trim();

    // Update chart options
    if (minutelyPrecipChart) {
        minutelyPrecipChart.options.scales.x.ticks.color = axisColor;
        minutelyPrecipChart.options.scales.y.ticks.color = axisColor;
        minutelyPrecipChart.options.scales.x.grid.color = gridColor;
        minutelyPrecipChart.options.scales.y.grid.color = gridColor;
        minutelyPrecipChart.options.scales.y.title.color = axisColor;
        minutelyPrecipChart.options.scales.x.title.color = axisColor;
        minutelyPrecipChart.update();
    }
}

// Ensure the precipitation chart grows to the width of its container once visible
export function ensurePrecipitationGraphWidth() {
	// console.log('ensurePrecipitationGraphWidth()');

    if (!minutelyPrecipChart) {
        return;
    }

    const maxAttempts = 5;

    const attemptResize = (attempt = 0) => {
        if (!minutelyPrecipChart) {
            return;
        }

        const container = document.getElementById('minutely-precip-container');
        if (!container) {
            return;
        }

        if (container.offsetWidth === 0) {
            if (attempt < maxAttempts) {
                requestAnimationFrame(() => attemptResize(attempt + 1));
            }
            return;
        }

        minutelyPrecipChart.resize();
    };

    attemptResize();
}

// Function to update chart data with sequential animation
function updateChartWithAnimation(chart, newLabels, newValues) {
	// console.log('updateChartWithAnimation()');

    // First update the labels if needed
    chart.data.labels = newLabels;
    
    // If there's an ongoing animation, cancel it
    if (chart.animationTimer) {
        clearTimeout(chart.animationTimer);
    }
    
    const valuesCount = newValues.length;
    
    // Ensure data arrays are the same length
    while (chart.data.datasets[0].data.length < valuesCount) {
        chart.data.datasets[0].data.push(0);
    }
    
    // Animation function to update values one by one
    let index = 0;
    
    function updateNextValue() {
        if (index < valuesCount) {
            // Update the current data point
            chart.data.datasets[0].data[index] = newValues[index];
            
            // Apply minimal animation for this update
            const updateOptions = {
                duration: 30,
                easing: 'easeOutQuad'
            };
            
            chart.update(updateOptions);
            
            // Schedule the next update
            index++;
            chart.animationTimer = setTimeout(updateNextValue, 30);
        } else {
            chart.animationTimer = null;
        }
    }
    
    // Start the sequential updates
    updateNextValue();
}

// Function to start auto-refresh for precipitation graph
function startPrecipGraphAutoRefresh() {
	// console.log('startPrecipGraphAutoRefresh()');

    const GRAPH_DELAY = 30; // seconds
    
    console.log('Starting precipitation graph auto-refresh...');
    
    // Clear any existing interval first
    clearInterval(precipGraphUpdateInterval);
    
    // Set up interval to update every 30 seconds
    precipGraphUpdateInterval = setInterval(() => {
        // Log refresh state
        console.log('Running precipitation graph refresh check...');
        updatePrecipitationGraph();
    }, GRAPH_DELAY*1000); // Update every n seconds
}

// Check for imminent rain (next 10 minutes) and alert user if so
function checkImminentRain(minutelyData) {
	// console.log('checkImminentRain()');

    if (!minutelyData || minutelyData.length === 0) {
        toggleRainIndicator(false);
        currentRainAlert = false; // Reset alert flag when no data
        return false;
    }
    
    // Get current time
    const currentTime = new Date();
    
    // Filter and process only the next 10 minutes of data
    const next15MinData = minutelyData.filter(minute => {
        const minuteTime = new Date(minute.dt * 1000);
        const timeDiffMinutes = (minuteTime - currentTime) / (60 * 1000);
        return timeDiffMinutes >= 0 && timeDiffMinutes <= 10;
    });
    
    // Determine if any precipitation is expected in the next 15 minutes
    // Using a small threshold to filter out trace amounts
    const precipThreshold = 0.1; // mm/hr
    const hasImminentRain = next15MinData.some(minute => 
        (minute.precipitation || 0) > precipThreshold
    );

    // Toggle the rain indicator based on our findings
    if (hasImminentRain) {
        // Calculate when rain will start (first minute above threshold)
        const rainStartIndex = next15MinData.findIndex(minute => 
            (minute.precipitation || 0) > precipThreshold
        );
        
        let minutesUntilRain = 0;
        if (rainStartIndex > 0) {
            const minuteTime = new Date(next15MinData[rainStartIndex].dt * 1000);
            minutesUntilRain = Math.round((minuteTime - currentTime) / (60 * 1000));
        }
        
        toggleRainIndicator(true, minutesUntilRain);
    } else {
        toggleRainIndicator(false);
    }
    
    // If rain is imminent and we don't have an active alert already, show a notification
    if (hasImminentRain && !currentRainAlert) {
        // Calculate when rain will start (first minute above threshold)
        const rainStartIndex = next15MinData.findIndex(minute => 
            (minute.precipitation || 0) > precipThreshold
        );
        
        // Find the maximum precipitation intensity in the next 15 minutes
        const maxPrecip = Math.max(...next15MinData.map(minute => minute.precipitation || 0));

        // Create the notification message
        let message;
        if (rainStartIndex === 0) {
            message = `Rain detected now! (${maxPrecip.toFixed(1)} mm/hr)`;
        } else if (rainStartIndex > 0) {
            const minuteTime = new Date(next15MinData[rainStartIndex].dt * 1000);
            const minutesUntilRain = Math.round((minuteTime - currentTime) / (60 * 1000));
            message = `Rain expected in ${minutesUntilRain} minute${minutesUntilRain > 1 ? 's' : ''} (${maxPrecip.toFixed(1)} mm/hr)`;
        }

        // Show the notification
        showNotification(message);
        // Set flag that we're under an active rain alert
        // This flag is also used to trigger more frequent weather updates
        currentRainAlert = true;
    } else if (!hasImminentRain) {
        // Reset the alert flag when there's no longer imminent rain
        currentRainAlert = false;
    }

    return hasImminentRain;
}

// Toggle the rain indicator
function toggleRainIndicator(show, minutesUntilRain = 0) {
	// console.log('toggleRainIndicator()');

    // Get the rain indicator element
    const rainIndicator = document.getElementById('rain-indicator');
    const rainTimingText = document.getElementById('rain-timing-text');
    
    if (rainIndicator) {
        if (show) {
            // Show the rain indicator by removing the hidden class
            rainIndicator.classList.remove('hidden');
            
            // Update the timing text
            if (rainTimingText) {
                if (minutesUntilRain === 0) {
                    rainTimingText.textContent = 'Now';
                } else {
                    rainTimingText.textContent = `${minutesUntilRain} min`;
                }
            }
        } else {
            // Hide the rain indicator by adding the hidden class
            rainIndicator.classList.add('hidden');
            
            // Clear the timing text
            if (rainTimingText) {
                rainTimingText.textContent = '';
            }
        }
    }
}

// Fetches and updates the Air Quality Index (AQI) from openweather.org
function updateAQI(lat, lon) {
	// console.log('updateAQI()');

    fetch(`php/openwx.php/data/2.5/air_pollution?lat=${lat}&lon=${lon}`)
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

            highlightUpdate('prem-aqi', aqiText);
            document.getElementById('prem-aqi-dot').style.backgroundColor = color;
        });
}

// Merge OneCall API data with 5-day forecast API data for extended hourly forecasts
function mergeForecastData(oneCallData, forecastData) {
	// console.log('mergeForecastData()');
    
    // Start with OneCall data as base (contains current, minutely, and first 2 days of hourly)
    const mergedData = { ...oneCallData };
    
    // Create complete 24-hour data structure for all 5 days
    const complete24HourData = createComplete24HourData(oneCallData, forecastData);
    
    // Replace the hourly data with our complete 24-hour structure
    mergedData.hourly = complete24HourData;
    
    // Update daily forecast to include data from 5-day forecast for days 3-5
    if (forecastData.list && forecastData.list.length > 0) {
        const extendedDailyData = generateDailyFromForecast(forecastData.list);
        
        // Replace days 3-5 in daily forecast with data from 5-day forecast
        if (mergedData.daily && mergedData.daily.length >= 2) {
            // Keep first 2 days from OneCall, then add days 3-5 from 5-day forecast
            // The 5-day forecast starts from day 1, so we need to skip the first 2 days
            // and take the next 3 days (which represent days 3-5)
            const days3to5 = extendedDailyData.slice(2, 5); // Skip first 2 days, take next 3
            
            mergedData.daily = [
                ...mergedData.daily.slice(0, 2), // First 2 days from OneCall (3.0 API)
                ...days3to5  // Days 3-5 from 5-day forecast (2.5 API)
            ];
        }
    }
    
    console.log(`Merged data: ${mergedData.hourly?.length || 0} hourly items, ${mergedData.daily?.length || 0} daily items`);
    return mergedData;
}

// Convert 3-hourly forecast data to hourly format
function convertForecastToHourly(forecastList) {
	// console.log('convertForecastToHourly()');

    return forecastList.map(item => ({
        dt: item.dt,
        temp: item.main.temp,
        feels_like: item.main.feels_like,
        pressure: item.main.pressure,
        humidity: item.main.humidity,
        dew_point: item.main.temp - ((100 - item.main.humidity) / 5), // Approximation
        uvi: 0, // Not available in 5-day forecast
        clouds: item.clouds.all,
        visibility: item.visibility || 10000,
        wind_speed: item.wind.speed,
        wind_deg: item.wind.deg,
        wind_gust: item.wind.gust || item.wind.speed,
        weather: item.weather,
        pop: item.pop || 0 // Probability of precipitation
    }));
}

// Generate daily summaries from 3-hourly forecast data
function generateDailyFromForecast(forecastList) {
	// console.log('generateDailyFromForecast()');

    const dailyData = {};
    
    // Group forecast data by day
    forecastList.forEach(item => {
        const date = new Date(item.dt * 1000);
        const dayKey = date.toDateString();
        
        if (!dailyData[dayKey]) {
            dailyData[dayKey] = {
                dt: item.dt,
                temps: [],
                humidity: [],
                pressure: [],
                weather: item.weather[0], // Use first weather entry as representative
                pop: item.pop || 0
            };
        }
        
        dailyData[dayKey].temps.push(item.main.temp);
        dailyData[dayKey].humidity.push(item.main.humidity);
        dailyData[dayKey].pressure.push(item.main.pressure);
        
        // Update probability of precipitation to maximum for the day
        if (item.pop > dailyData[dayKey].pop) {
            dailyData[dayKey].pop = item.pop;
        }
    });
    
    // Convert grouped data to daily format
    return Object.values(dailyData).map(day => ({
        dt: day.dt,
        sunrise: day.dt, // Approximation - would need additional API call for exact times
        sunset: day.dt + 12 * 3600, // Approximation - 12 hours later
        moonrise: day.dt + 18 * 3600, // Approximation
        moonset: day.dt + 6 * 3600, // Approximation
        moon_phase: 0.5, // Approximation - would need additional calculation
        temp: {
            day: Math.round(day.temps.reduce((a, b) => a + b, 0) / day.temps.length),
            min: Math.round(Math.min(...day.temps)),
            max: Math.round(Math.max(...day.temps)),
            night: Math.round(day.temps[day.temps.length - 1] || day.temps[0]),
            eve: Math.round(day.temps[Math.floor(day.temps.length * 0.75)] || day.temps[0]),
            morn: Math.round(day.temps[0])
        },
        feels_like: {
            day: Math.round(day.temps.reduce((a, b) => a + b, 0) / day.temps.length),
            night: Math.round(day.temps[day.temps.length - 1] || day.temps[0]),
            eve: Math.round(day.temps[Math.floor(day.temps.length * 0.75)] || day.temps[0]),
            morn: Math.round(day.temps[0])
        },
        pressure: Math.round(day.pressure.reduce((a, b) => a + b, 0) / day.pressure.length),
        humidity: Math.round(day.humidity.reduce((a, b) => a + b, 0) / day.humidity.length),
        dew_point: 0, // Would need calculation
        wind_speed: 0, // Would need to track and average
        wind_deg: 0,
        wind_gust: 0,
        weather: [day.weather],
        clouds: 0,
        pop: day.pop,
        uvi: 0 // Not available
    }));
}

// Helper: Extract 5 daily summaries from merged forecast data
function extractPremiumDailyForecast(dailyList) {
	// console.log('extractPremiumDailyForecast()');

    // Limit to 5 days as requested in the issue
    return dailyList.slice(0, 5);
}

// Helper: Format temperature based on user settings
function formatTemperature(tempF) {
	// console.log('formatTemperature()');

    if (!settings || settings["imperial-units"]) {
        return Math.round(tempF) + "°";
    } else {
        // Convert F to C: (F - 32) * 5/9
        return Math.round((tempF - 32) * 5/9) + "°";
    }
}

// Helper: Format wind speed range
function formatWindSpeedRange(speedMS, gustMS = null) {
	// console.log('formatWindSpeedRange()');

    const isImperial = !settings || settings["imperial-units"];
    if (gustMS && gustMS > speedMS) {
        if (isImperial) {
            // Convert m/s to mph
            return `${Math.round(speedMS * 2.237)}–${Math.round(gustMS * 2.237)} MPH`;
        } else {
            // Keep as m/s
            return `${Math.round(speedMS)}–${Math.round(gustMS)} m/s`;
        }
    } else {
        if (isImperial) {
            // Convert m/s to mph
            return Math.round(speedMS * 2.237) + " MPH";
        } else {
            // Keep as m/s
            return Math.round(speedMS) + " m/s";
        }
    }
}

// Helper: Check for hazards in a premium daily forecast
function premiumDayHasHazards(day) {
	// console.log('premiumDayHasHazards()');

    const hazardConditions = ['Rain', 'Snow', 'Sleet', 'Hail', 'Thunderstorm', 'Storm', 'Drizzle'];
    return day.weather.some(w =>
        hazardConditions.some(condition =>
            w.main.includes(condition) || w.description.toLowerCase().includes(condition.toLowerCase())
        )
    );
}

// Helper: Generate CSS styling for the moon phase icon based on phase value
function getMoonPhaseIcon(phase) {
	// console.log('getMoonPhaseIcon()');

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

// Helper: Return string description of the closest moon phase
function getMoonPhaseName(phase) {
	// console.log('getMoonPhaseName()');

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

// Helper: Generate test minutely precipitation data for testing
function generateTestMinutelyData(forecastData) {
	// console.log('generateTestMinutelyData()');

    // Create minutely data if it doesn't exist
    if (!forecastData.minutely || forecastData.minutely.length < 60) {
        forecastData.minutely = [];
        
        // Current timestamp in seconds, minus a random offset of 0-10 minutes
        const randomOffsetMinutes = Math.floor(Math.random() * 11); // 0-10 minutes
        const nowSec = Math.floor(Date.now() / 1000) - (randomOffsetMinutes * 60);
        console.log(`TEST MODE: Setting initial time to ${randomOffsetMinutes} minutes in the past`);
        
        // Generate 60 minutes of data
        for (let i = 0; i < 60; i++) {
            // First 18 data points have zero precipitation
            const precipitation = i < 18 ? 0 : Math.random() * 5;
            
            forecastData.minutely.push({
                dt: nowSec + (i * 60),
                precipitation: precipitation
            });
        }
    } else {
        // Modify existing minutely data
        const randomOffsetMinutes = Math.floor(Math.random() * 11); // 0-10 minutes
        const nowSec = Math.floor(Date.now() / 1000) - (randomOffsetMinutes * 60);
        console.log(`TEST MODE: Setting initial time to ${randomOffsetMinutes} minutes in the past`);
        
        forecastData.minutely.forEach((minute, index) => {
            minute.dt = nowSec + (index * 60);
            // First 18 data points have zero precipitation
            minute.precipitation = index < 18 ? 0 : Math.random() * 5;
        });
    }
    
    // Make sure at least some values are non-zero to trigger display
    // Set a few minutes after the initial 18 to have definite precipitation
    for (let i = 25; i < 40; i++) {
        if (i < forecastData.minutely.length) {
            forecastData.minutely[i].precipitation = 2 + Math.random() * 3; // 2-5 mm/hr
        }
    }
    
    return forecastData;
}

// Generate test weather alerts for demo purposes
function generateTestWeatherAlerts(forecastData) {
	// console.log('generateTestWeatherAlerts()');

    const now = Math.floor(Date.now() / 1000);
    const testAlerts = [
        {
            sender_name: "National Weather Service - TEST MODE",
            event: "Winter Storm Warning",
            start: now - 3600, // Started 1 hour ago
            end: now + 21600, // Ends in 6 hours
            description: "Heavy snow expected. Total snow accumulations of 8 to 14 inches possible. Winds could gust as high as 40 mph. Travel will be very difficult to impossible.",
            tags: ["Snow", "Wind"]
        },
        {
            sender_name: "Emergency Management - TEST MODE",
            event: "High Wind Watch", 
            start: now - 1800, // Started 30 minutes ago
            end: now + 18000, // Ends in 5 hours
            description: "Sustained winds of 35 to 45 mph with gusts up to 65 mph possible. Damaging winds could blow down trees and power lines.",
            tags: ["Wind"]
        }
    ];
    
    // Add alerts to forecast data
    forecastData.alerts = testAlerts;
    console.log('TEST MODE: Added test weather alerts', testAlerts);
    
    return forecastData;
}

// Generate test daily forecast data with various weather conditions to test backgrounds
function generateTestDailyForecast(forecastData) {
	// console.log('generateTestDailyForecast()');

    const now = Math.floor(Date.now() / 1000);
    const daySeconds = 24 * 60 * 60;
    
    const weatherTypes = [
        { main: "Snow", description: "heavy snow", icon: "13d" },
        { main: "Rain", description: "moderate rain", icon: "10d" },
        { main: "Clouds", description: "overcast clouds", icon: "04d" },
        { main: "Thunderstorm", description: "thunderstorm", icon: "11d" },
        { main: "Clear", description: "clear sky", icon: "01d" },
        { main: "Clouds", description: "few clouds", icon: "02d" },
        { main: "Rain", description: "light rain", icon: "09d" }
    ];
    
    for (let i = 0; i < 5; i++) {
        const dayTime = now + (i * daySeconds);
        const weather = weatherTypes[i % weatherTypes.length];
        
        forecastData.daily.push({
            dt: dayTime,
            temp: {
                min: 20 + (i * 5),
                max: 35 + (i * 5)
            },
            weather: [weather]
        });
    }
    
    console.log('TEST MODE: Generated test daily forecast with various weather conditions');
    return forecastData;
}

// Generate test hourly forecast data to simulate both 1-hour and 3-hour data
function generateTestHourlyForecast(forecastData) {
	// console.log('generateTestHourlyForecast()');

    const now = Math.floor(Date.now() / 1000);
    const hourSeconds = 60 * 60;
    
    const weatherTypes = [
        { main: "Snow", description: "heavy snow", icon: "13d" },
        { main: "Rain", description: "moderate rain", icon: "10d" },
        { main: "Clouds", description: "overcast clouds", icon: "04d" },
        { main: "Thunderstorm", description: "thunderstorm", icon: "11d" },
        { main: "Clear", description: "clear sky", icon: "01d" }
    ];
    
    // Generate hourly data for 5 days (120 hours)
    for (let i = 0; i < 120; i++) {
        const hourTime = now + (i * hourSeconds);
        const dayIndex = Math.floor(i / 24);
        const weather = weatherTypes[dayIndex % weatherTypes.length];
        
        // Simulate temperature variation throughout the day
        const baseTemp = 20 + (dayIndex * 5);
        const hourOfDay = i % 24;
        const tempVariation = Math.sin((hourOfDay - 6) * Math.PI / 12) * 8; // Warmer during day
        const temp = Math.round(baseTemp + tempVariation);
        
        forecastData.hourly.push({
            dt: hourTime,
            temp: temp,
            feels_like: temp - 2,
            pressure: 1013,
            humidity: 65,
            dew_point: temp - 10,
            uvi: Math.max(0, Math.sin((hourOfDay - 6) * Math.PI / 12) * 8), // UV during day only
            clouds: 50 + (dayIndex * 10),
            visibility: 10000,
            wind_speed: 5 + Math.random() * 10,
            wind_deg: Math.floor(Math.random() * 360),
            wind_gust: 15 + Math.random() * 10,
            weather: [weather],
            pop: weather.main === "Rain" ? 0.8 : (weather.main === "Snow" ? 0.9 : 0.2)
        });
    }
    
    console.log('TEST MODE: Generated test hourly forecast data for 5 days');
    return forecastData;
}

function updateForecastPopupTop(force = false) {
	// Keep the popup vertically aligned to the daily cards
    const forecastContainer = document.getElementById('prem-forecast-container');
    const premPopup = document.querySelector('#weather .forecast-popup');
    if (!forecastContainer || !premPopup) {
        return;
    }

    if (!force && !premPopup.classList.contains('show')) {
        return;
    }

    const containerRect = forecastContainer.getBoundingClientRect();
    const popupTop = Math.max(0, Math.round(containerRect.bottom + HOURLY_POPUP_GAP));
    premPopup.style.setProperty('--forecast-popup-top', `${popupTop}px`);
}

function initializeForecastPopupPositioning() {
    const reposition = () => updateForecastPopupTop();

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, { passive: true });

    const rightFrame = document.getElementById('rightFrame');
    if (rightFrame) {
        rightFrame.addEventListener('scroll', reposition, { passive: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeForecastPopupPositioning);
} else {
    initializeForecastPopupPositioning();
}

window.showPremiumPrecipGraph = function(dayIndex) {
	// console.log('showPremiumPrecipGraph()');

    if (!forecastDataPrem) return;

    const daily = forecastDataPrem.daily || [];
    const hourly = forecastDataPrem.hourly || [];

    if (!daily[dayIndex]) return;

    // Highlight the selected forecast day panel
    const forecastDays = document.querySelectorAll('#prem-forecast-container .forecast-day');
    forecastDays.forEach((day, index) => {
        if (index === dayIndex) {
            day.classList.add('selected');
        } else {
            day.classList.remove('selected');
        }
    });

    // Show only the premium popup
    const premPopup = document.querySelector('#weather .forecast-popup');
    if (premPopup) {
        updateForecastPopupTop(true);
        premPopup.classList.add('show');
    }
    const dimOverlay = document.getElementById('forecast-dim-overlay');
    if (dimOverlay) {
        dimOverlay.classList.add('show');
    }

    // Calculate start/end of the selected day in local time
    const selectedDate = new Date(daily[dayIndex].dt * 1000);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Set popup title with local date - no resolution indicator to make it transparent to user
    const popupDate = premPopup.querySelector('#popup-date');
    if (popupDate) {
        const dateStr = selectedDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
        popupDate.textContent = dateStr;
    }

    const hourlyContainer = premPopup.querySelector('.hourly-forecast');
    
    // Show hourly forecasts for days 1-2, and 3-hourly for days 3-5
    if (dayIndex > 4) {
        // Beyond day 5 - should not happen with our 5-day limit
        hourlyContainer.replaceChildren();
        const msgDiv = document.createElement('div');
        msgDiv.style.gridColumn = '1/-1';
        msgDiv.style.textAlign = 'center';
        msgDiv.style.padding = '20px';
        const p = document.createElement('p');
        p.textContent = 'Forecast is only available for the next 5 days.';
        msgDiv.appendChild(p);
        hourlyContainer.appendChild(msgDiv);
        return;
    }

    // Determine the time resolution based on the day index
    const isHourlyDay = dayIndex < 2; // Days 1-2 have true hourly resolution
    
    // Filter hourly data for the selected day using local time comparison
    let dayHourly = hourly.filter(h => {
        const itemDate = new Date(h.dt * 1000);
        return itemDate >= dayStart && itemDate <= dayEnd;
    });
    
    // For days 3-5, interpolate hourly data from 3-hourly data to provide consistent hourly experience
    if (!isHourlyDay && dayHourly.length > 0) {
        dayHourly = interpolateHourlyFromThreeHourly(dayHourly, daily[dayIndex]);
    }

    // Create a new timeline-based hourly forecast view
    if (hourlyContainer) {
        // Make sure we have at least one hour of data
        if (dayHourly.length === 0) {
            hourlyContainer.replaceChildren();
            const msgDiv = document.createElement('div');
            msgDiv.style.gridColumn = '1/-1';
            msgDiv.style.textAlign = 'center';
            msgDiv.style.padding = '20px';
            const p = document.createElement('p');
            p.textContent = 'No hourly data available for this day.';
            msgDiv.appendChild(p);
            hourlyContainer.appendChild(msgDiv);
            return;
        }
        
        // First, set up the container styles for the new timeline layout
        hourlyContainer.style.display = 'flex';
        hourlyContainer.style.flexDirection = 'column';
        hourlyContainer.style.width = '100%';
        hourlyContainer.style.padding = '0'; // Remove padding to align date heading with timeline
        
        // Create a timeline view with continuous weather rectangles
        hourlyContainer.replaceChildren();
        const timelineContainer = document.createElement('div');
        timelineContainer.className = 'timeline-container';
        const weatherRow = document.createElement('div');
        weatherRow.className = 'timeline-weather-row';
        timelineContainer.appendChild(weatherRow);
                
        // Create weather condition rectangles and detect weather changes for icon placement
        let prevWeatherMain = null;
        let weatherChangePoints = [];
        let weatherChangeIcons = [];
        
        // Calculate total width of each hour segment
        const hourWidth = 100 / dayHourly.length; // percentage width
            
        // Generate the weather rectangles
        dayHourly.forEach((item, index) => {
            const weatherCondition = item.weather[0].main.toLowerCase();
            const itemDate = new Date(item.dt * 1000);
            const hour = itemDate.getHours();

            // Check for weather condition changes to place icons
            if (prevWeatherMain !== item.weather[0].main) {
                weatherChangePoints.push(index);
                weatherChangeIcons.push({
                    position: index,
                    icon: item.weather[0].icon,
                    description: item.weather[0].description
                });
                prevWeatherMain = item.weather[0].main;
            }

            // Add the weather condition rectangle
            const rect = document.createElement('div');
            rect.className = `timeline-hour ${weatherCondition}`;
            rect.dataset.hour = hour;
            rect.dataset.temp = item.temp;
            rect.dataset.weather = item.weather[0].main;
            weatherRow.appendChild(rect);
        });

        // Add weather change icons
        const iconsDiv = document.createElement('div');
        iconsDiv.className = 'weather-icons';
        weatherChangeIcons.forEach(change => {
            // Position the icon exactly at the boundary between hours
            const iconLeft = change.position * hourWidth;
            const iconDiv = document.createElement('div');
            iconDiv.className = 'weather-change-icon';
            iconDiv.style.left = `${iconLeft}%`;
            const img = document.createElement('img');
            img.src = `https://openweathermap.org/img/wn/${change.icon}.png`;
            img.alt = change.description;
            img.title = change.description;
            iconDiv.appendChild(img);
            iconsDiv.appendChild(iconDiv);
        });
        timelineContainer.appendChild(iconsDiv);

        // Add temperature indicators (every 3 hours for consistency)
        const tempDiv = document.createElement('div');
        tempDiv.className = 'temperature-indicators';
        dayHourly.forEach((item, index) => {
            const itemDate = new Date(item.dt * 1000);
            const hour = itemDate.getHours();

            // Show temperature every 3 hours for consistency (hour % 3 === 0 or first item)
            const showTemp = (hour % 3 === 0 || index === 0);
            if (showTemp) {
                // Center the temperature in each rectangle
                const tempLeft = (index * hourWidth) + (hourWidth / 2);
                const tempIndicator = document.createElement('div');
                tempIndicator.className = 'temp-indicator';
                tempIndicator.style.left = `${tempLeft}%`;
                tempIndicator.textContent = formatTemperature(item.temp);
                tempDiv.appendChild(tempIndicator);
            }
        });
        timelineContainer.appendChild(tempDiv);

        // Add hour labels at the bottom (every 3 hours for readability)
        const labelsDiv = document.createElement('div');
        labelsDiv.className = 'hour-labels';

        dayHourly.forEach((item, index) => {
            const itemDate = new Date(item.dt * 1000);
            const hour = itemDate.getHours();

            // Show labels every 3 hours for consistency and readability
            const showLabel = (hour % 3 === 0 || index === 0);
            if (showLabel) {
                // Position labels to align with the center of their corresponding rectangle
                const labelLeft = (index * hourWidth) + (hourWidth / 2);
                const time = formatTime(itemDate, {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                const label = document.createElement('div');
                label.className = 'hour-label';
                label.style.left = `${labelLeft}%`;
                label.textContent = time;
                labelsDiv.appendChild(label);
            }
        });
        timelineContainer.appendChild(labelsDiv);

        hourlyContainer.appendChild(timelineContainer);

        // Add a legend for weather conditions
        const legendDiv = document.createElement('div');
        legendDiv.className = 'weather-legend';

        // Get unique weather conditions for legend
        const uniqueConditions = new Set();
        dayHourly.forEach(item => uniqueConditions.add(item.weather[0].main));

        uniqueConditions.forEach(condition => {
            const conditionClass = condition.toLowerCase();
            const legendItem = document.createElement('div');
            legendItem.className = `legend-item ${conditionClass}`;
            const colorDiv = document.createElement('div');
            colorDiv.className = 'legend-color';
            const span = document.createElement('span');
            span.textContent = condition;
            legendItem.appendChild(colorDiv);
            legendItem.appendChild(span);
            legendDiv.appendChild(legendItem);
        });

        hourlyContainer.appendChild(legendDiv);
    }
};

// Close forecast window
window.closePremiumPrecipPopup = function() {
	// console.log('closePremiumPrecipPopup()');

    const premPopup = document.querySelector('#weather .forecast-popup');
    if (premPopup) {
        premPopup.classList.remove('show');
        premPopup.style.removeProperty('--forecast-popup-top');
    }
    const dimOverlay = document.getElementById('forecast-dim-overlay');
    if (dimOverlay) dimOverlay.classList.remove('show');

    // Remove highlighting from all forecast day panels
    const forecastDays = document.querySelectorAll('#prem-forecast-container .forecast-day');
    forecastDays.forEach(day => day.classList.remove('selected'));
}

// Switches the weather image based on the type provided
window.switchWeatherImage = function (type) {
        // console.log('switchWeatherImage()');

    const weatherImage = document.getElementById('weather-image');
    weatherImage.style.opacity = '0';

    const source = getActiveSatelliteSource();
    const resolvedType = source.availability[type] ? type : getFirstAvailableType();
    currentSatelliteType = resolvedType;

    setTimeout(() => {
        const url = getSatelliteUrl(resolvedType);
        if (url) {
            weatherImage.src = url;
        }
        weatherImage.style.opacity = '1';
    }, 300);

    // Update buttons and slider position
    const weatherSwitch = document.querySelector('.weather-switch');
    if (!weatherSwitch) return;
    const buttons = weatherSwitch.getElementsByTagName('button');
    buttons[0].classList.toggle('active', resolvedType === 'latest');
    buttons[1].classList.toggle('active', resolvedType === 'loop');
    buttons[2].classList.toggle('active', resolvedType === 'latest_ir');

    // Update slider position for three states
    const positions = { 'latest': 0, 'loop': 1, 'latest_ir': 2 };
    weatherSwitch.style.setProperty('--slider-position', positions[resolvedType]);

    updateSatelliteControls();
}

// Process weather alerts from OpenWeather API response
function processWeatherAlerts(weatherData) {
	// console.log('processWeatherAlerts()');

    if (!weatherData || !weatherData.alerts) {
        // Clear any existing alerts if no alert data
        currentWeatherAlerts = [];
        updateWeatherAlertIndicator();
        return;
    }

    const now = Date.now() / 1000; // Current time in Unix timestamp
    const activeAlerts = weatherData.alerts.filter(alert => 
        alert.start <= now && alert.end >= now
    );

    // Check for new significant alerts that need popup
    const newSignificantAlerts = activeAlerts.filter(alert => 
        isSignificantAlert(alert) && 
        !currentWeatherAlerts.some(existing => 
            existing.event === alert.event && 
            existing.start === alert.start
        )
    );

    // Update current alerts array
    currentWeatherAlerts = activeAlerts;

    // Show popup for new significant alerts
    if (newSignificantAlerts.length > 0 && (now - lastAlertCheck) > 300) { // 5 min cooldown
        showWeatherAlertModal(newSignificantAlerts[0]); // Show first alert
        lastAlertCheck = now;
    }

    // Update alert indicators
    updateWeatherAlertIndicator();
    
    // Update weather alerts display in the weather section
    updateWeatherAlertsDisplay();
}

// Determine if an alert is considered "significant" and should trigger popup
function isSignificantAlert(alert) {
	// console.log('isSignificantAlert()');

    const significantEvents = [
        'Tornado Warning', 'Tornado Watch',
        'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
        'Flash Flood Warning', 'Flash Flood Watch',
        'Flood Warning', 'Flood Watch',
        'Winter Storm Warning', 'Winter Storm Watch',
        'Blizzard Warning', 'Blizzard Watch',
        'Ice Storm Warning',
        'High Wind Warning', 'High Wind Watch',
        'Hurricane Warning', 'Hurricane Watch',
        'Tropical Storm Warning', 'Tropical Storm Watch'
    ];
    
    return significantEvents.some(event => 
        alert.event && alert.event.toLowerCase().includes(event.toLowerCase())
    );
}

// Update the weather alert count indicator
function updateWeatherAlertIndicator() {
	// console.log('updateWeatherAlertIndicator()');

    const alertCount = currentWeatherAlerts.length;
    const weatherButton = document.getElementById('wx-section');
    
    if (!weatherButton) return;
    
    // Show/hide the alert indicator by adding/removing CSS class and data attribute
    if (alertCount > 0) {
        weatherButton.classList.add('has-weather-alert');
        weatherButton.setAttribute('data-alert-count', alertCount);
        weatherButton.title = `${alertCount} Weather Alert${alertCount > 1 ? 's' : ''} Active`;
    } else {
        weatherButton.classList.remove('has-weather-alert');
        weatherButton.removeAttribute('data-alert-count');
        weatherButton.title = '';
    }
}
