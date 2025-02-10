let lastUpdate = 0;
let lat = null;
let long = null;
let sunrise = null;
let sunset = null;
let moonPhaseData = null;

function toggleMode() {
    document.body.classList.toggle('dark-mode');
    document.getElementById('darkModeToggle').checked = document.body.classList.contains('dark-mode');
}

async function updateLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            lat = position.coords.latitude;
            long = position.coords.longitude;
            console.log(`Location updated: ${lat}, ${long}`);

            // Update location display
            document.getElementById('latitude').innerText = lat.toFixed(4) + '°';
            document.getElementById('longitude').innerText = long.toFixed(4) + '°';

            // If the Connectivity section is visible, update the IP data
            const connectivitySection = document.getElementById('connectivity');
            if (connectivitySection.style.display === 'block') {
                updateConnectionInfo();
            }

            // Fire off async API requests for external data
            fetchCityData(lat, long);
            fetchSunData(lat, long);
        });
    } else {
        console.log('Geolocation is not supported by this browser.');
    }
}

function fetchCityData(lat, long) {
    fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${long}&localityLanguage=en`)
        .then(response => response.json())
        .then(cityData => {
            document.getElementById('city').innerText =
                (cityData.locality || 'N/A') + ', ' +
                (cityData.principalSubdivision || 'N/A');
        })
        .catch(error => {
            console.error('Error fetching city data:', error);
        });
}

function fetchSunData(lat, long) {
    Promise.all([
        fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${long}&formatted=0`),
        fetch(`https://api.farmsense.net/v1/moonphases/?d=${Math.floor(Date.now() / 1000)}`)
    ])
        .then(([sunResponse, moonResponse]) => Promise.all([sunResponse.json(), moonResponse.json()]))
        .then(([sunData, moonData]) => {
            sunrise = sunData.results.sunrise;
            sunset = sunData.results.sunset;
            moonPhaseData = moonData[0];
            
            document.getElementById('sunrise').innerText = new Date(sunrise).toLocaleTimeString();
            document.getElementById('sunset').innerText = new Date(sunset).toLocaleTimeString();
            document.getElementById('moonphase').innerText = getMoonPhaseName(moonPhaseData.Phase);
            
            // Automatically apply dark mode based on the local time
            updateAutoDarkMode();
        })
        .catch(error => {
            console.error('Error fetching sun/moon data:', error);
        });
}

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

function updateAutoDarkMode() {
    if (lat !== null && long !== null) {
        const now = new Date();
        const currentTime = now.getTime();
        const sunriseTime = new Date(sunrise).getTime();
        const sunsetTime = new Date(sunset).getTime();

        if (currentTime >= sunsetTime || currentTime < sunriseTime) {
            console.log('Applying dark mode based on sunset...');
            document.body.classList.add('dark-mode');
            document.getElementById('darkModeToggle').checked = true;
        } else {
            console.log('Applying light mode based on sunrise...');
            document.body.classList.remove('dark-mode');
            document.getElementById('darkModeToggle').checked = false;
        }
    } else {
        console.log('Location not available for auto dark mode.');
    }
}

async function updateConnectionInfo() {
    try {
        // Get detailed IP info from ipapi.co
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();

        // Update the UI with the fetched data
        document.getElementById('rdns').innerText = data.ip || 'N/A';
        document.getElementById('location').innerText = `${data.city || 'N/A'}, ${data.region || 'N/A'}, ${data.country_name || 'N/A'}`;
        document.getElementById('isp').innerText = data.org || 'N/A';
    } catch (error) {
        console.error('Error fetching IP information: ', error);
        // Set default values in case of error
        document.getElementById('rdns').innerText = 'N/A';
        document.getElementById('location').innerText = 'N/A';
        document.getElementById('isp').innerText = 'N/A';
    }
}

function showSection(sectionId) {
    // Log the clicked section
    console.log(`Showing section: ${sectionId}`);

    // Hide all sections
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });

    // Deactivate all buttons
    const buttons = document.querySelectorAll('.section-button');
    buttons.forEach(button => {
        button.classList.remove('active');
    });

    // Show the selected section
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
    }

    // Activate the clicked button
    const button = document.querySelector(`.section-button[onclick="showSection('${sectionId}')"]`);
    if (button) {
        button.classList.add('active');
    }

    // Handle special cases
    if (sectionId === 'connectivity') {
        const now = Date.now();
        if (now - lastUpdate > 60000) { // 60 seconds
            console.log('Updating connectivity section...');
            updateConnectionInfo();
            lastUpdate = now;
        } else {
            console.log('Skipping update, too soon...');
        }
    }
}

// Update location on page load and every minute thereafter
updateLocation();
setInterval(updateLocation, 60000);

// Show the first section by default
showSection('news');
