// Settings
const OPENWX_API_KEY = '6a1b1bcb03b5718a9b3a2b108ce3293d';

// Globals
let moonPhaseData = null;
let weatherData = null;
let forecastFetched = false;
let forecastData = null;

// Functions

function getMoonPhaseName(phase) {
    // Convert numerical phase to human-readable name
    if (phase === 0 || phase === 1) return "New Moon";
    if (phase < 0.25) return "Waxing Crescent";
    if (phase === 0.25) return "First Quarter";
    if (phase < 0.5) return "Waxing Gibbous";
    if (phase === 0.5) return "Full Moon";
    if (phase < 0.75) return "Waning Gibbous";
    if (phase === 0.75) return "Last Quarter";
    return "Waning Crescent";
}

function switchWeatherImage(type) {
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

function fetchWeatherData(lat, long) {
    console.log('Fetching weather data...');
    Promise.all([
        fetch(`https://secure.geonames.org/findNearByWeatherJSON?lat=${lat}&lng=${long}&username=birgefuller`),
        !forecastFetched ? fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${long}&appid=${OPENWX_API_KEY}&units=imperial`) : Promise.resolve(null)
    ])
        .then(([currentResponse, forecastResponse]) => Promise.all([
            currentResponse.json(),
            forecastResponse ? forecastResponse.json() : null
        ]))
        .then(([currentData, forecastData]) => {
            if (currentData.weatherObservation) {
                weatherData = currentData.weatherObservation;
                updateWeatherDisplay();
            }
            
            if (forecastData && !forecastFetched) {
                updateForecastDisplay(forecastData);
                forecastFetched = true;
            }
        })
        .catch(error => {
            console.error('Error fetching weather data: ', error);
        });
}

function hasHazards(forecastData) {
    // Weather conditions that warrant an alert
    const hazardConditions = ['Rain', 'Snow', 'Sleet', 'Hail', 'Thunderstorm', 'Storm', 'Drizzle'];
    return forecastData.weather.some(w => 
        hazardConditions.some(condition => 
            w.main.includes(condition) || w.description.includes(condition.toLowerCase())
        )
    );
}

function updateForecastDisplay(data) {
    const forecastDays = document.querySelectorAll('.forecast-day');
    const dailyData = extractDailyForecast(data.list);
    
    dailyData.forEach((day, index) => {
        if (index < forecastDays.length) {
            const date = new Date(day.dt * 1000);
            const dayElement = forecastDays[index];
            
            // Clear previous content
            dayElement.innerHTML = '';
            
            // Add alert symbol if hazards detected
            if (hasHazards(day)) {
                const alert = document.createElement('div');
                alert.className = 'forecast-alert';
                alert.innerHTML = '⚠️';
                dayElement.appendChild(alert);
            }
            
            // Add the rest of the forecast content
            dayElement.innerHTML += `
                <div class="forecast-date">${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <img class="forecast-icon" src="https://openweathermap.org/img/wn/${day.weather[0].icon}@2x.png" alt="${day.weather[0].description}">
                <div class="forecast-temp">${Math.round(day.temp_min)}°/${Math.round(day.temp_max)}°</div>
                <div class="forecast-desc">${day.weather[0].main}</div>
            `;
        }
    });
}

function extractDailyForecast(forecastList) {
    forecastData = forecastList;
    const dailyData = [];
    const dayMap = new Map();
    
    forecastList.forEach(item => {
        const date = new Date(item.dt * 1000).toDateString();
        
        if (!dayMap.has(date)) {
            dayMap.set(date, {
                dt: item.dt,
                temp_min: item.main.temp_min,
                temp_max: item.main.temp_max,
                weather: [item.weather[0]]  // Initialize weather array
            });
        } else {
            const existing = dayMap.get(date);
            existing.temp_min = Math.min(existing.temp_min, item.main.temp_min);
            existing.temp_max = Math.max(existing.temp_max, item.main.temp_max);
            // Add weather condition if it's not already included
            if (!existing.weather.some(w => w.main === item.weather[0].main)) {
                existing.weather.push(item.weather[0]);
            }
        }
    });
    
    dayMap.forEach(day => dailyData.push(day));
    return dailyData.slice(0, 5);
}

function showHourlyForecast(dayIndex) {
    if (!forecastData) return;

    const startDate = new Date(forecastData[0].dt * 1000).setHours(0, 0, 0, 0);
    const targetDate = new Date(startDate + dayIndex * 24 * 60 * 60 * 1000);
    const endDate = new Date(targetDate).setHours(23, 59, 59, 999);

    // Filter forecast data for the selected day
    const hourlyData = forecastData.filter(item => {
        const itemDate = new Date(item.dt * 1000);
        return itemDate >= targetDate && itemDate <= endDate;
    });

    // Create the popup content
    const popupDate = document.getElementById('popup-date');
    popupDate.textContent = targetDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    const hourlyContainer = document.querySelector('.hourly-forecast');
    hourlyContainer.innerHTML = hourlyData.map(item => {
        const time = new Date(item.dt * 1000).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });
        return `
            <div class="hourly-item">
                <div class="hourly-time">${time}</div>
                <img src="https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png" alt="${item.weather[0].description}" style="width: 50px; height: 50px;">
                <div class="hourly-temp">${Math.round(item.main.temp)}°F</div>
                <div class="hourly-desc">${item.weather[0].main}</div>
            </div>
        `;
    }).join('');

    // Show the popup and overlay
    document.querySelector('.overlay').classList.add('show');
    document.querySelector('.forecast-popup').classList.add('show');
}

function closeHourlyForecast() {
    document.querySelector('.overlay').classList.remove('show');
    document.querySelector('.forecast-popup').classList.remove('show');
}

function updateWeatherDisplay() {
    if (!weatherData) return;

    const windSpeedMS = weatherData.windSpeed;
    const windSpeedMPH = Math.min((windSpeedMS * 2.237), MAX_SPEED); // Convert m/s to mph and clip
    const windDir = weatherData.windDirection;
    const humidity = weatherData.humidity;

    document.getElementById('humidity').innerText = `${humidity}%`;
    document.getElementById('wind').innerText = `${Math.round(windSpeedMPH)} mph at ${Math.round(windDir)}°`;
    
    // Update radar display if we have vehicle data
    if (locationBuffer.length >= 2) {
        const latestPoint = locationBuffer[locationBuffer.length - 1];
        const prevPoint = locationBuffer[locationBuffer.length - 2];
        const speed = Math.min(estimateSpeed(prevPoint, latestPoint), MAX_SPEED);
        const heading = calculateHeading(prevPoint, latestPoint);
        updateWindage(speed, heading, windSpeedMPH, windDir);
    } else {
        // Just show wind if we don't have vehicle data
        updateWindage(0, 0, windSpeedMPH, windDir);
    }
}
