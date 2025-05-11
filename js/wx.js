// Import required functions from app.js
import { formatTime, highlightUpdate, testMode } from './common.js';
import { autoDarkMode, settings } from './settings.js';

// Parameters
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
let city = null;                        // Variable to store the city name
let state = null;                       // Variable to store the state name
let country = null;                     // Variable to store the country name
let inCONUS = null;                     // Variable to store if the location is in the continental US (CONUS)

// Export these variables for use in other modules
export { SAT_URLS, forecastDataPrem, lastLat, lastLong, city, state };

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

    // Fetch and update weather data
    fetch(`openwx.php/data/3.0/onecall?lat=${lat}&lon=${long}&units=imperial`)
        .then(response => response.json())
        .then(forecastDataLocal => {
            if (forecastDataLocal) {
                forecastDataPrem = forecastDataLocal;
                
                // If in test mode, generate random precipitation data for minutely forecast
                if (testMode) {
                    console.log('TEST MODE: Generating random precipitation data');
                    // Create minutely data if it doesn't exist
                    if (!forecastDataPrem.minutely || forecastDataPrem.minutely.length < 60) {
                        forecastDataPrem.minutely = [];
                        
                        // Current timestamp in seconds, minus a random offset of 0-10 minutes
                        const randomOffsetMinutes = Math.floor(Math.random() * 11); // 0-10 minutes
                        const nowSec = Math.floor(Date.now() / 1000) - (randomOffsetMinutes * 60);
                        console.log(`TEST MODE: Setting initial time to ${randomOffsetMinutes} minutes in the past`);
                        
                        // Generate 60 minutes of data
                        for (let i = 0; i < 60; i++) {
                            // First 18 data points have zero precipitation
                            const precipitation = i < 18 ? 0 : Math.random() * 5;
                            
                            forecastDataPrem.minutely.push({
                                dt: nowSec + (i * 60),
                                precipitation: precipitation
                            });
                        }
                    } else {
                        // Modify existing minutely data
                        const randomOffsetMinutes = Math.floor(Math.random() * 11); // 0-10 minutes
                        const nowSec = Math.floor(Date.now() / 1000) - (randomOffsetMinutes * 60);
                        console.log(`TEST MODE: Setting initial time to ${randomOffsetMinutes} minutes in the past`);
                        
                        forecastDataPrem.minutely.forEach((minute, index) => {
                            minute.dt = nowSec + (index * 60);
                            // First 18 data points have zero precipitation
                            minute.precipitation = index < 18 ? 0 : Math.random() * 5;
                        });
                    }
                    
                    // Make sure at least some values are non-zero to trigger display
                    // Set a few minutes after the initial 18 to have definite precipitation
                    for (let i = 25; i < 40; i++) {
                        if (i < forecastDataPrem.minutely.length) {
                            forecastDataPrem.minutely[i].precipitation = 2 + Math.random() * 3; // 2-5 mm/hr
                        }
                    }
                } // test mode
                
                updatePremiumWeatherDisplay();

                // Update time and location of weather data, using FormatTime
                const weatherUpdateTime = formatTime(new Date(forecastDataLocal.current.dt * 1000), {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                // Update station info robustly
                if (testMode) {
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

            // Hide spinner and show forecast when data is loaded - only if not silent loading
            if (forecastContainer) forecastContainer.style.display = lastDisplayStyle;
            if (loadingSpinner) loadingSpinner.style.display = 'none';

            // Update auto-dark mode if enabled
            autoDarkMode(lat, long);
        })
        .catch(error => {
            console.error('Error fetching forecast data: ', error);

            // In case of error, hide spinner and show error message - only if not silent loading
            if (!silentLoad) {
                if (loadingSpinner) loadingSpinner.style.display = 'none';
            }
        });
}

// Fetch city data based on latitude and longitude
export async function fetchCityData(lat, long) {
    try {
        const response = await fetch(`openwx.php/geo/1.0/reverse?lat=${lat}&lon=${long}&limit=1`);
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

    // Extract daily summary (first 5 days)
    const dailyData = extractPremiumDailyForecast(forecastDataPrem.daily || []);
    const forecastDays = document.querySelectorAll('#prem-forecast-container .forecast-day');

    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            const hourlyAvail = index < 2 ? true : false;

            // Update weather condition class
            const hourlyClass = hourlyAvail ? 'hourly-avail' : null;
            const weatherCondition = day.weather[0].main.toLowerCase();
            dayElement.className = `forecast-day ${hourlyClass} ${weatherCondition}`;

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
    // Hide spinner, show forecast
    const forecastContainer = document.getElementById('prem-forecast-container');
    const loadingSpinner = document.getElementById('prem-forecast-loading');
    if (forecastContainer) forecastContainer.classList.remove('hidden');
    if (loadingSpinner) loadingSpinner.style.display = 'none';

    // Update precipitation graph with time-based x-axis
    updatePrecipitationGraph();

    // Log minutely data for debugging
    // if (forecastDataPrem.minutely) {
    //     console.log('Minutely data:', forecastDataPrem.minutely);
    // } else {
    //     console.log('No minutely data available.');
    // }
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
        }).filter(item => item.x >= 0); // Filter out past times (negative values)

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
                                        size: 22,
                                    }
                                },
                                ticks: {
                                    font: {
                                        size: 18
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
                                        size: 22,
                                    }
                                },
                                beginAtZero: true,
                                ticks: {
                                    font: {
                                        size: 18
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

    // Return true if the refresh should continue
    return true;
}

// Function to update chart data with sequential animation
function updateChartWithAnimation(chart, newLabels, newValues) {
    // First update the labels if needed
    chart.data.labels = newLabels;
    
    // If there's an ongoing animation, cancel it
    if (chart.animationTimer) {
        clearTimeout(chart.animationTimer);
    }
    
    // const originalValues = [...chart.data.datasets[0].data];
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
            // Final update with nice animation
            // chart.update();
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
    
    // Initial update
    // updatePrecipitationGraph();
    
    // Set up interval to update every 30 seconds
    precipGraphUpdateInterval = setInterval(() => {
        // Log refresh state
        console.log('Running precipitation graph refresh check...');
        updatePrecipitationGraph();
    }, GRAPH_DELAY*1000); // Update every n seconds
}

// Check for imminent rain (next 15 minutes) and alert user if so
function checkImminentRain(minutelyData) {
    if (!minutelyData || minutelyData.length === 0) {
        toggleRainIndicator(false);
        currentRainAlert = false; // Reset alert flag when no data
        return false;
    }
    
    // Get current time
    const currentTime = new Date();
    
    // Filter and process only the next 15 minutes of data
    const next15MinData = minutelyData.filter(minute => {
        const minuteTime = new Date(minute.dt * 1000);
        const timeDiffMinutes = (minuteTime - currentTime) / (60 * 1000);
        return timeDiffMinutes >= 0 && timeDiffMinutes <= 15;
    });
    
    // Determine if any precipitation is expected in the next 15 minutes
    // Using a small threshold to filter out trace amounts
    const precipThreshold = 0.1; // mm/hr
    const hasImminentRain = next15MinData.some(minute => 
        (minute.precipitation || 0) > precipThreshold
    );

    // Toggle the rain indicator based on our findings
    toggleRainIndicator(hasImminentRain);
    
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
        currentRainAlert = true;
    } else if (!hasImminentRain) {
        // Reset the alert flag when there's no longer imminent rain
        currentRainAlert = false;
    }

    return hasImminentRain;
}

// Toggle the rain indicator
function toggleRainIndicator(show) {
    // Get or create the rain indicator element
    let rainIndicator = document.getElementById('rain-indicator');
    
    if (!rainIndicator && show) {
        // Create the rain indicator if it doesn't exist
        rainIndicator = document.createElement('div');
        rainIndicator.id = 'rain-indicator';
        rainIndicator.className = 'status-indicator rain-status';
        rainIndicator.title = 'Rain expected within 15 minutes';
        
        // Add img element for cloud icon using the external SVG file
        rainIndicator.innerHTML = `<img src="assets/cloud.svg" alt="Rain Alert" width="24" height="24">`;
        
        // Insert at the beginning of the control container and center it horizontally
        const controlContainer = document.querySelector('.control-container');
        if (controlContainer) {
            controlContainer.insertBefore(rainIndicator, controlContainer.firstChild);
        }
    } else if (rainIndicator && !show) {
        // Remove the indicator if it exists and should not be shown
        rainIndicator.remove();
    }
}

// Fetches and updates the Air Quality Index (AQI) from openweather.org
function updateAQI(lat, lon) {
    fetch(`openwx.php/data/2.5/air_pollution?lat=${lat}&lon=${lon}`)
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

// Show a temporary notification
// TODO: Move this to common.js
function showNotification(message) {
    // Check if a notification container already exists
    let notificationContainer = document.getElementById('notification-container');
    
    if (!notificationContainer) {
        // Create a notification container if it doesn't exist
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
    
    // Create the notification element
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `
        <div class="notification-icon">
            <img src="assets/cloud.svg" alt="Alert" width="24" height="24">
        </div>
        <div class="notification-message">${message}</div>
    `;
    
    // Add the notification to the container
    notificationContainer.appendChild(notification);
    
    // Make the notification visible with a fade-in effect
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Remove the notification after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        notification.classList.add('hide');
        
        // Remove the element after the fade-out animation completes
        setTimeout(() => {
            notification.remove();
            
            // Remove the container if there are no more notifications
            if (notificationContainer.children.length === 0) {
                notificationContainer.remove();
            }
        }, 500);
    }, 5000);
}

// Helper: Extract 5 daily summaries from OpenWeather 3.0 API
function extractPremiumDailyForecast(dailyList) {
    // dailyList is already daily summaries (up to 8 days)
    return dailyList.slice(0, 5);
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

// Show forecast window (used to be a graph) for a premium forecast day
window.showPremiumPrecipGraph = function(dayIndex) {
    if (!forecastDataPrem) return;

    const daily = forecastDataPrem.daily || [];
    const hourly = forecastDataPrem.hourly || [];

    if (!daily[dayIndex]) return;

    // Show only the premium popup
    const premPopup = document.querySelector('#prem-weather .forecast-popup');
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
        hourlyContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 20px;">
                <p>Detailed hourly forecast is only available for the next 2 days.</p>
            </div>`;
        return;
    }

    // Check if we're beyond the hourly forecast limit (48 hours) - keeping this check as a fallback
    const now = new Date();
    const hoursDiff = (dayStart - now) / (1000 * 60 * 60);

    if (hoursDiff >= 48) {
        // Beyond hourly forecast limit - show simplified message
        hourlyContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 20px;">
                <p>Detailed hourly forecast is only available for the next 48 hours.</p>
            </div>`;
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
            hourlyContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px;">
                <p>No hourly data available for this day.</p>
            </div>`;
            return;
        }
        
        // First, set up the container styles for the new timeline layout
        hourlyContainer.style.display = 'flex';
        hourlyContainer.style.flexDirection = 'column';
        hourlyContainer.style.width = '100%';
        hourlyContainer.style.padding = '0'; // Remove padding to align date heading with timeline
        
        // Create a timeline view with continuous weather rectangles
        let timelineHTML = `
            <div class="timeline-container">
            <div class="timeline-weather-row">`;
                
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
            timelineHTML += `
                <div class="timeline-hour ${weatherCondition}"
                data-hour="${hour}" data-temp="${item.temp}" data-weather="${item.weather[0].main}">
                </div>
            `;
        });
            
        timelineHTML += `</div>`;
            
        // Add weather change icons
        timelineHTML += `<div class="weather-icons">`;
        
        weatherChangeIcons.forEach(change => {
            // Position the icon exactly at the boundary between hours
            const iconLeft = change.position * hourWidth;
            timelineHTML += `
                <div class="weather-change-icon" style="left: ${iconLeft}%;">
                    <img src="https://openweathermap.org/img/wn/${change.icon}.png" 
                        alt="${change.description}" 
                        title="${change.description}">
                </div>
            `;
        });
        
        timelineHTML += `</div>`;
        
        // Add temperature indicators (every 3 hours)
        timelineHTML += `<div class="temperature-indicators">`;
        
        dayHourly.forEach((item, index) => {
            const itemDate = new Date(item.dt * 1000);
            const hour = itemDate.getHours();
            
            // Only show temperature every 3 hours
            if (hour % 3 === 0 || index === 0) {
                // Center the temperature in each rectangle
                const tempLeft = (index * hourWidth) + (hourWidth / 2);
                timelineHTML += `
                    <div class="temp-indicator" style="left: ${tempLeft}%;">
                        ${formatTemperature(item.temp)}
                    </div>
                `;
            }
        });
        
        timelineHTML += `</div>`;
        
        // Add hour labels at the bottom (every 3 hours)
        timelineHTML += `<div class="hour-labels">`;
        
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
                
                timelineHTML += `
                    <div class="hour-label" style="left: ${labelLeft}%;">
                        ${time}
                    </div>
                `;
            }
        });
        
        timelineHTML += `</div>`;
        timelineHTML += `</div>`;
        
        // Add a legend for weather conditions
        timelineHTML += `
            <div class="weather-legend">
        `;
        
        // Get unique weather conditions for legend
        const uniqueConditions = new Set();
        dayHourly.forEach(item => uniqueConditions.add(item.weather[0].main));
        
        uniqueConditions.forEach(condition => {
            const conditionClass = condition.toLowerCase();
            timelineHTML += `
                <div class="legend-item ${conditionClass}">
                    <div class="legend-color"></div>
                    <span>${condition}</span>
                </div>
            `;
        });
        
        timelineHTML += `</div>`;
        
        hourlyContainer.innerHTML = timelineHTML;
    }
};

// Close forecast window
window.closePremiumPrecipPopup = function() {
    const premPopup = document.querySelector('#prem-weather .forecast-popup');
    if (premPopup) premPopup.classList.remove('show');
}

// Attach event listeners for premium forecast popup close
document.addEventListener('DOMContentLoaded', function () {
    var premCloseBtn = document.getElementById('prem-forecast-popup-close');
    if (premCloseBtn) {
        premCloseBtn.onclick = window.closePremiumPrecipPopup;
    }
});

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
