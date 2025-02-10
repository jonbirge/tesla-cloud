let lastUpdate = 0;

function toggleMode() {
    document.body.classList.toggle('dark-mode');
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
            document.getElementById('rdns').innerText = data.reverse;
            document.getElementById('location').innerText = `${data.city}, ${data.region}, ${data.country}`;
            document.getElementById('isp').innerText = data.isp;
            
        });
}

// Show the first section by default
showSection('news');
// showSection('connectivity');
