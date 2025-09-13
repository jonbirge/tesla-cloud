// Import required functions from app.js
import { formatTime, highlightUpdate, testMode, isTestMode, showNotification, showWeatherAlertModal } from './common.js';
import { autoDarkMode, settings } from './settings.js';

// Parameters
const HOURLY_FORECAST_DAYS = 2;
const SAT_URLS = {
    latest: 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/1250x750.jpg',
    loop: 'https://cdn.star.nesdis.noaa.gov/GOES16/GLM/CONUS/EXTENT3/GOES16-CONUS-EXTENT3-625x375.gif',
    latest_ir: 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/11/1250x750.jpg',
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

// Export these variables for use in other modules
export { SAT_URLS, forecastDataPrem, lastLat, lastLong, city, state, currentRainAlert, currentWeatherAlerts };

// Fetches premium weather data from OpenWeather API
export function fetchPremiumWeatherData(lat, long, silentLoad = false) {
    console.log('Fetching premium weather data...');

    // Save so we can call functions later outside GPS update loop, if needed
    lastLat = lat;
    lastLong = long;

    // Show loading state on forecast container when not silent loading
    if (!silentLoad) {
        document.getElementById('prem-forecast-container').classList.add('loading');
    }

    // Fetch and update weather data
    fetch(`php/openwx.php/data/3.0/onecall?lat=${lat}&lon=${long}&units=imperial`)
        .then(response => response.json())
        .then(forecastDataLocal => {
            if (forecastDataLocal) {
                forecastDataPrem = forecastDataLocal;
                
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
                processWeatherAlerts(forecastDataLocal);

                // Update time and location of weather data, using FormatTime
                const weatherUpdateTime = formatTime(new Date(forecastDataLocal.current.dt * 1000), {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // Update station info robustly
                if (isTestMode('wx') || isTestMode('alert')) {
                    const stationStr = `TEST WX @ ${weatherUpdateTime}`;
                    highlightUpdate('prem-station-info', stationStr);
                } else if (city && state) {
                    const stationStr = `${city}, ${state} @ ${weatherUpdateTime}`;
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

            // In test mode, create dummy forecast data with alerts for testing
            if (isTestMode('alert')) {
                console.log('TEST MODE (alert): API failed, creating dummy forecast data with alerts');
                forecastDataPrem = {
                    current: { dt: Math.floor(Date.now() / 1000), temp: 32 },
                    daily: [],
                    hourly: [],
                    minutely: []
                };
                generateTestDailyForecast(forecastDataPrem);
                generateTestWeatherAlerts(forecastDataPrem);
                processWeatherAlerts(forecastDataPrem);
                updateWeatherAlertIndicator();
                updateWeatherAlertsDisplay(); // Make sure to show alerts in weather section
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

            // If we're in CONUS, show the "sat-section" button
            const satSection = document.getElementById('sat-section');
            if (satSection) {
                if (inCONUS) {
                    console.log('Location is in CONUS');
                    satSection.classList.remove('hidden');
                } else {
                    console.log('Location is NOT in CONUS');
                    satSection.classList.add('hidden');
                }
            }
        } else {
            console.log('No location data available.');
        }
    } catch (error) {
        console.error('Error fetching location data: ', error);
    }
}

// Updates the forecast display with premium data
export function updatePremiumWeatherDisplay() {
    if (!forecastDataPrem) return;

    // Extract daily summary (first 7 days)
    const dailyData = extractPremiumDailyForecast(forecastDataPrem.daily || []);
    const forecastDays = document.querySelectorAll('#prem-forecast-container .forecast-day');

    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            const hourlyAvail = index < 2 ? true : false;

            // Update weather condition class
            // Only use clear for the first two days when hourly stripes are enabled
            const weatherClass = (settings["show-hourly-stripes"] !== false && index < 2) ? 'clear' : day.weather[0].main.toLowerCase();
            const hourlyClass = hourlyAvail ? 'hourly-avail' : '';
            dayElement.className = `forecast-day ${hourlyClass} ${weatherClass}`;

            // Clear any existing hourly segments
            const existingSegments = dayElement.querySelector('.hourly-segments');
            if (existingSegments) {
                existingSegments.remove();
            }

            // Add hourly segments for the first two days if enabled
            if (settings["show-hourly-stripes"] !== false && index < HOURLY_FORECAST_DAYS && forecastDataPrem.hourly) {
                const hourlySegments = createHourlySegments(day, forecastDataPrem.hourly);
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

            // Attach click handler for precipitation graph?
            if (hourlyAvail) {
                dayElement.onclick = () => showPremiumPrecipGraph(index);
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
                color: black;
                font-style: italic;
            `;

            const alertTime = document.createElement('div');
            alertTime.style.cssText = `
                font-size: 12px;
                color: #999;
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
function createHourlySegments(dailyForecast, hourlyData) {
    // Calculate start/end of the day in local time
    const selectedDate = new Date(dailyForecast.dt * 1000);
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);
    
    const now = new Date();
    const isToday = now.toDateString() === selectedDate.toDateString();
    
    // Filter hourly data for this specific day
    const dayHourly = hourlyData.filter(h => {
        const itemDate = new Date(h.dt * 1000);
        return itemDate >= dayStart && itemDate <= dayEnd;
    });

    if (dayHourly.length === 0) {
        return null; // No hourly data available for this day
    }

    // Create the hourly segments container
    const segmentsContainer = document.createElement('div');
    segmentsContainer.className = 'hourly-segments';
    
    // Get starting hour - if today, start from current hour, otherwise start from 0
    const startHour = isToday ? now.getHours() : 0;
    const hoursToShow = 24 - startHour;
    
    // Create segments only for remaining hours (or all hours for future days)
    for (let h = 0; h < hoursToShow; h++) {
        const hour = startHour + h;
        const segment = document.createElement('div');
        segment.className = 'hourly-segment';
        
        // Find the hourly data for this specific hour
        const hourData = dayHourly.find(h => {
            const itemDate = new Date(h.dt * 1000);
            return itemDate.getHours() === hour;
        });

        if (hourData) {
            // Apply weather condition class based on hourly data - only for non-clear conditions
            const weatherCondition = hourData.weather[0].main.toLowerCase();
            if (weatherCondition !== 'clear') {
                segment.classList.add(weatherCondition);
            } else {
                // For clear conditions, don't add any background - let the main clear background show through
                segment.style.background = 'transparent';
            }
        } else {
            // Fallback to daily forecast weather if no hourly data for this hour - only for non-clear conditions
            const weatherCondition = dailyForecast.weather[0].main.toLowerCase();
            if (weatherCondition !== 'clear') {
                segment.classList.add(weatherCondition);
            } else {
                // For clear conditions, don't add any background - let the main clear background show through
                segment.style.background = 'transparent';
            }
        }

        segmentsContainer.appendChild(segment);
    }

    return segmentsContainer;
}

// Function to update precipitation graph with current time-based x-axis
function updatePrecipitationGraph() {
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
    // Console log
    console.log('Updating rain chart axis colors...');

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

// Function to update chart data with sequential animation
function updateChartWithAnimation(chart, newLabels, newValues) {
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

// Helper: Extract 5 daily summaries from OpenWeather 3.0 API
function extractPremiumDailyForecast(dailyList) {
    // dailyList is already daily summaries (up to 8 days)
    return dailyList.slice(0, 7);
}

// Helper: Format temperature based on user settings
function formatTemperature(tempF) {
    if (!settings || settings["imperial-units"]) {
        return Math.round(tempF) + "°";
    } else {
        // Convert F to C: (F - 32) * 5/9
        return Math.round((tempF - 32) * 5/9) + "°";
    }
}

// Helper: Format wind speed range
function formatWindSpeedRange(speedMS, gustMS = null) {
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
    const hazardConditions = ['Rain', 'Snow', 'Sleet', 'Hail', 'Thunderstorm', 'Storm', 'Drizzle'];
    return day.weather.some(w =>
        hazardConditions.some(condition =>
            w.main.includes(condition) || w.description.toLowerCase().includes(condition.toLowerCase())
        )
    );
}

// Helper: Generate CSS styling for the moon phase icon based on phase value
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

// Helper: Return string description of the closest moon phase
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

// Helper: Generate test minutely precipitation data for testing
function generateTestMinutelyData(forecastData) {
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
    
    for (let i = 0; i < 7; i++) {
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

// Show forecast window (used to be a graph) for a premium forecast day
window.showPremiumPrecipGraph = function(dayIndex) {
    if (!forecastDataPrem) return;

    const daily = forecastDataPrem.daily || [];
    const hourly = forecastDataPrem.hourly || [];

    if (!daily[dayIndex]) return;

    // Show only the premium popup
    const premPopup = document.querySelector('#weather .forecast-popup');
    if (premPopup) {
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

    const hourlyContainer = premPopup.querySelector('.hourly-forecast');
    
    // Simple rule: Only show hourly forecasts for the first two days (index 0 and 1)
    if (dayIndex > 1) {
        // Beyond day 2 - show simplified message
        hourlyContainer.replaceChildren();
        const msgDiv = document.createElement('div');
        msgDiv.style.gridColumn = '1/-1';
        msgDiv.style.textAlign = 'center';
        msgDiv.style.padding = '20px';
        const p = document.createElement('p');
        p.textContent = 'Detailed hourly forecast is only available for the next 2 days.';
        msgDiv.appendChild(p);
        hourlyContainer.appendChild(msgDiv);
        return;
    }

    // Check if we're beyond the hourly forecast limit (48 hours) - keeping this check as a fallback
    const now = new Date();
    const hoursDiff = (dayStart - now) / (1000 * 60 * 60);

    if (hoursDiff >= 48) {
        // Beyond hourly forecast limit - show simplified message
        hourlyContainer.replaceChildren();
        const msgDiv = document.createElement('div');
        msgDiv.style.gridColumn = '1/-1';
        msgDiv.style.textAlign = 'center';
        msgDiv.style.padding = '20px';
        const p = document.createElement('p');
        p.textContent = 'Detailed hourly forecast is only available for the next 48 hours.';
        msgDiv.appendChild(p);
        hourlyContainer.appendChild(msgDiv);
        return;
    }

    // Filter hourly data for the selected day using local time comparison
    const dayHourly = hourly.filter(h => {
        const itemDate = new Date(h.dt * 1000);
        return itemDate >= dayStart && itemDate <= dayEnd;
    });

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

        // Add temperature indicators (every 3 hours)
        const tempDiv = document.createElement('div');
        tempDiv.className = 'temperature-indicators';
        dayHourly.forEach((item, index) => {
            const itemDate = new Date(item.dt * 1000);
            const hour = itemDate.getHours();

            // Only show temperature every 3 hours
            if (hour % 3 === 0 || index === 0) {
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

        // Add hour labels at the bottom (every 3 hours)
        const labelsDiv = document.createElement('div');
        labelsDiv.className = 'hour-labels';

        dayHourly.forEach((item, index) => {
            const itemDate = new Date(item.dt * 1000);
            const hour = itemDate.getHours();

            // Only show labels every 3 hours
            if (hour % 3 === 0 || index === 0) {
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
    const premPopup = document.querySelector('#weather .forecast-popup');
    if (premPopup) premPopup.classList.remove('show');
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

// Process weather alerts from OpenWeather API response
function processWeatherAlerts(weatherData) {
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

// Update the red dot weather alert indicator
function updateWeatherAlertIndicator() {
    const hasSignificantAlerts = currentWeatherAlerts.some(alert => isSignificantAlert(alert));
    const weatherButton = document.getElementById('wx-section');
    
    if (!weatherButton) return;
    
    // Show/hide the alert indicator by adding/removing CSS class and data attribute
    if (hasSignificantAlerts) {
        weatherButton.classList.add('has-weather-alert');
        weatherButton.title = 'Weather Alert Active';
    } else {
        weatherButton.classList.remove('has-weather-alert');
        weatherButton.title = '';
    }
}
