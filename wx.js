// Import required functions from app.js
import { formatTime, highlightUpdate, testMode } from './common.js';
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
                
                // If in test mode, generate random precipitation data for minutely forecast
                if (testMode) {
                    console.log('TEST MODE: Generating random precipitation data');
                    // Create minutely data if it doesn't exist
                    if (!forecastDataPrem.minutely || forecastDataPrem.minutely.length < 60) {
                        forecastDataPrem.minutely = [];
                        
                        // Current timestamp in seconds
                        const nowSec = Math.floor(Date.now() / 1000);
                        
                        // Generate 60 minutes of data
                        for (let i = 0; i < 60; i++) {
                            forecastDataPrem.minutely.push({
                                dt: nowSec + (i * 60),
                                precipitation: Math.random() * 5 // Random value between 0-5 mm/hr
                            });
                        }
                    } else {
                        // Modify existing minutely data
                        forecastDataPrem.minutely.forEach(minute => {
                            minute.precipitation = Math.random() * 5; // Random value between 0-5 mm/hr
                        });
                    }
                    
                    // Make sure at least some values are non-zero to trigger display
                    // Set a few minutes to have definite precipitation
                    for (let i = 10; i < 30; i++) {
                        if (i < forecastDataPrem.minutely.length) {
                            forecastDataPrem.minutely[i].precipitation = 2 + Math.random() * 3; // 2-5 mm/hr
                        }
                    }
                }
                
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

            if (lat && long) {
                updateAQI(lat, long);
            }

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
            let windText;
            if (windGust && windGust > windSpeed) {
                // Show wind-gust format
                windText = `${formatWindSpeedRange(windSpeed, windGust)} at ${Math.round(windDir)}°`;
            } else {
                // Just show regular wind speed if no gust data
                windText = `${formatWindSpeed(windSpeed)} at ${Math.round(windDir)}°`;
            }
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

    // --- Minutely Precipitation Graph Logic ---
    const minutely = forecastDataPrem.minutely || [];
    let hasMinutelyPrecip = false;
    let precipData = [];
    let labels = [];

    if (minutely.length > 0) {
        // Only consider the next hour (60 min)
        precipData = minutely.slice(0, 60).map(m => m.precipitation || 0);
        
        // Change: Use "time until" in minutes for X-axis labels, starting at 0
        labels = minutely.slice(0, 60).map((m, index) => index.toString());
        
        hasMinutelyPrecip = precipData.some(val => val > 0);
        
        // Check for rain in the next 15 minutes and show alert if detected
        checkImminentRain(minutely);
    } else {
        // If no minutely data available, make sure to hide the rain indicator
        toggleRainIndicator(false);
    }

    const minutelyContainer = document.getElementById('minutely-precip-container');
    const minutelyChartCanvas = document.getElementById('minutely-precip-chart');
    // const premWxSectionBtn = document.getElementById('prem-wx-section');

    if (hasMinutelyPrecip && minutelyContainer && minutelyChartCanvas) {
        minutelyContainer.style.display = '';

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
                    x: { 
                        title: { 
                            display: true, 
                            text: 'Minutes from now',
                            font: {
                                size: 22,
                                weight: 650
                            }
                        },
                        ticks: {
                            font: {
                                size: 18
                            }
                        } 
                    },
                    y: { 
                        title: { 
                            display: true, 
                            text: 'Precipitation (mm/hr)',
                            font: {
                                size: 22,
                                weight: 650
                            }
                        }, 
                        beginAtZero: true,
                        ticks: {
                            font: {
                                size: 18
                            }
                        }
                    }
                }
            }
        });
    } else {
        // Hide the graph and remove alert dot
        if (minutelyContainer) minutelyContainer.style.display = 'none';
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

// New function: Check for imminent rain (next 15 minutes)
function checkImminentRain(minutelyData) {
    if (!minutelyData || minutelyData.length === 0) {
        toggleRainIndicator(false);
        return false;
    }
    
    // Check only the next 15 minutes
    const next15MinData = minutelyData.slice(0, 15);
    
    // Determine if any precipitation is expected in the next 15 minutes
    // Using a small threshold to filter out trace amounts
    const precipThreshold = 0.1; // mm/hr
    const hasImminentRain = next15MinData.some(minute => 
        (minute.precipitation || 0) > precipThreshold
    );
    
    // Toggle the rain indicator based on our findings
    toggleRainIndicator(hasImminentRain);
    
    // If rain is imminent, show a notification
    if (hasImminentRain) {
        // Calculate when rain will start (first minute above threshold)
        const rainStartMinute = next15MinData.findIndex(minute => 
            (minute.precipitation || 0) > precipThreshold
        );
        
        // Find the maximum precipitation intensity in the next 15 minutes
        const maxPrecip = Math.max(...next15MinData.map(minute => minute.precipitation || 0));
        
        // Create the notification message
        let message;
        if (rainStartMinute === 0) {
            message = `Rain detected now! (${maxPrecip.toFixed(1)} mm/hr)`;
        } else {
            message = `Rain expected in ${rainStartMinute} minute${rainStartMinute > 1 ? 's' : ''} (${maxPrecip.toFixed(1)} mm/hr)`;
        }
        
        // Show the notification
        showNotification(message);
    }
    
    return hasImminentRain;
}

// New function: Toggle the rain indicator
function toggleRainIndicator(show) {
    // Get or create the rain indicator element
    let rainIndicator = document.getElementById('rain-indicator');
    
    if (!rainIndicator && show) {
        // Create the rain indicator if it doesn't exist
        rainIndicator = document.createElement('div');
        rainIndicator.id = 'rain-indicator';
        rainIndicator.className = 'status-indicator rain-status';
        rainIndicator.title = 'Rain expected within 15 minutes';
        
        // Add SVG icon for cloud (changed from rain icon)
        rainIndicator.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <path class="cloud-icon" fill="currentColor" d="M19.35,10.03C18.67,6.59 15.64,4 12,4C9.11,4 6.6,5.64 5.35,8.03C2.34,8.36 0,10.9 0,14A6,6 0 0,0 6,20H19A5,5 0 0,0 24,15C24,12.36 21.95,10.22 19.35,10.03Z"/>
            </svg>
        `;
        
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

// New function: Show a temporary notification
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M19.35,10.03C18.67,6.59 15.64,4 12,4C9.11,4 6.6,5.64 5.35,8.03C2.34,8.36 0,10.9 0,14A6,6 0 0,0 6,20H19A5,5 0 0,0 24,15C24,12.36 21.95,10.22 19.35,10.03Z"/>
            </svg>
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
        }, 300);
    }, 5000);
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

// Add this new helper function before the end of the file, near the other formatting functions
function formatWindSpeedRange(speedMS, gustMS) {
    if (!settings || settings["imperial-units"]) {
        // Convert m/s to mph
        return `${Math.round(speedMS * 2.237)}-${Math.round(gustMS * 2.237)} MPH`;
    } else {
        // Keep as m/s
        return `${Math.round(speedMS)}-${Math.round(gustMS)} m/s`;
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

// Premium popup close handler
window.closePremiumPrecipPopup = function() {
    const premPopup = document.querySelector('#prem-weather .forecast-popup');
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
                <img src="https://openweathermap.org/img/wn/${item.weather[0].icon}.png" alt="${item.weather[0].description}" class="hourly-icon">
                <div class="hourly-temp">${formatTemperature(item.main.temp)}</div>
                <div class="hourly-desc">${item.weather[0].main}</div>
            </div>
        `;
    }).join('');

    document.querySelector('.forecast-popup').classList.add('show');
}

// Closes the hourly forecast popup
window.closeHourlyForecast = function () {
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
