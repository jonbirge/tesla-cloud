let lastUpdate = 0;
let lat = null;
let long = null;
let sunrise = null;
let sunset = null;

function toggleMode() {
    document.body.classList.toggle('dark-mode');
    document.getElementById('darkModeToggle').checked = document.body.classList.contains('dark-mode');
}

async function updateLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            lat = position.coords.latitude;
            long = position.coords.longitude;
            console.log(`Location updated: ${lat}, ${long}`);

            // Update location display
            document.getElementById('latitude').innerText = lat.toFixed(4) + '°';
            document.getElementById('longitude').innerText = long.toFixed(4) + '°';

            // Fetch city data
            fetchCityData(lat, long).then(cityData => {
                document.getElementById('city').innerText =
                    (cityData.locality || 'N/A') + ', ' +
                    (cityData.principalSubdivision || 'N/A');
            }).catch(error => {
                console.error('Error fetching city data:', error);
            });

            // Fetch sun data
            fetchSunData(lat, long).then(sunData => {
                sunrise = sunData.results.sunrise;
                sunset = sunData.results.sunset;
                document.getElementById('sunrise').innerText = new Date(sunrise).toLocaleTimeString();
                document.getElementById('sunset').innerText = new Date(sunset).toLocaleTimeString();

                // Automatically apply dark mode based on the local time
                applyAutoDarkMode();
            }).catch(error => {
                console.error('Error fetching sun data:', error);
            });
        });
    } else {
        console.log('Geolocation is not supported by this browser.');
    }
}

async function fetchCityData(latitude, longitude) {
    const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
    return response.json();
}

async function fetchSunData(latitude, longitude) {
    const response = await fetch(`https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&formatted=0`);
    return response.json();
}

function applyAutoDarkMode() {
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

// Dynamically update IP data in 'Connectivity' section from data returned by ipinfo.php
function updateConnectionInfo() {
    fetch('ipinfo.php')
        .then(response => response.json())
        .then(data => {
            // if data.reverse is defined, use it, otherwise use data.ip
            if (data.reverse) {
                document.getElementById('rdns').innerText = data.reverse;
            } else {
                document.getElementById('rdns').innerText = data.ip;
            }
            document.getElementById('location').innerText = `${data.city}, ${data.region}, ${data.country}`;
            document.getElementById('isp').innerText = data.isp;
        });
}

// Update location on page load and every minute thereafter
updateLocation();
setInterval(updateLocation, 60000);

// Show the first section by default
showSection('news');
