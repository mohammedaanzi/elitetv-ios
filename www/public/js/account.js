document.addEventListener('DOMContentLoaded', function () {
    console.log("Profile Page Loaded");

    // --- ELEMENTS ---
    const elUsername = document.getElementById('disp-username');
    const elStatus = document.getElementById('disp-status');
    const elExpiry = document.getElementById('disp-expiry');
    const elMax = document.getElementById('disp-max');
    const elActive = document.getElementById('disp-active');
    const elTrial = document.getElementById('disp-trial');
    const elCreated = document.getElementById('disp-created');
    const elClock = document.getElementById('clock');

    const btnBack = document.getElementById('btn-back');
    const btnLogout = document.getElementById('btn-logout');

    // Navigation
    const navItems = [btnBack, btnLogout];
    let focusIndex = 0;

    // --- CLOCK ---
    function updateClock() {
        const now = new Date();
        if(elClock) elClock.textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --- CLICK LISTENERS ---
    if(btnBack) {
        btnBack.addEventListener('click', () => {
            window.location.href = 'screen.html';
        });
        btnBack.addEventListener('mouseenter', () => { focusIndex = 0; updateFocus(); });
    }

    if(btnLogout) {
        btnLogout.addEventListener('click', async () => {
            // 🟢 CLEAR STORAGE
            localStorage.clear(); // Clear login info
            
            // 🟢 CLEAR DATABASE (CACHE)
            await clearAllDatabases();

            // Redirect
            window.location.href = 'index.html';
        });
        btnLogout.addEventListener('mouseenter', () => { focusIndex = 1; updateFocus(); });
    }

    // --- DATABASE CLEAR FUNCTION ---
    function clearAllDatabases() {
        return new Promise((resolve) => {
            // We delete both DB versions just in case
            const req1 = indexedDB.deleteDatabase('DipPlayerDB');
            const req2 = indexedDB.deleteDatabase('DipPlayerDB_V2');
            const req3 = indexedDB.deleteDatabase('DipMoviesDB'); // The new Movies DB

            // Wait a tiny bit to ensure deletion starts
            setTimeout(() => {
                console.log("Databases Cleared");
                resolve();
            }, 500);
        });
    }

    // --- KEYBOARD HANDLER ---
    document.addEventListener('keydown', function (e) {
        const keyCode = e.keyCode;
        switch (keyCode) {
            case 37: // LEFT
                if (focusIndex > 0) { focusIndex--; updateFocus(); }
                break;
            case 39: // RIGHT
                if (focusIndex < navItems.length - 1) { focusIndex++; updateFocus(); }
                break;
            case 38: // UP
                if (focusIndex > 0) { focusIndex--; updateFocus(); }
                break;
            case 40: // DOWN
                if (focusIndex < navItems.length - 1) { focusIndex++; updateFocus(); }
                break;
            case 13: // ENTER
            case 23: // DPAD CENTER
                if(focusIndex === 0) btnBack.click();
                else btnLogout.click();
                break;
        }
    });

    // --- BACK BUTTON ---
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('backButton', () => {
            window.location.href = 'screen.html';
        });
    }

    // --- LOAD USER DATA ---
    const username = localStorage.getItem('iptv_username');
    const password = localStorage.getItem('iptv_password');
    const dns = localStorage.getItem('iptv_dns');

    if (!username || !password) {
        window.location.href = 'index.html';
    } else {
        fetchUserData();
    }

    function formatTime(timestamp) {
        if (!timestamp || timestamp === "null") return "Unlimited";
        if (!isNaN(timestamp)) {
            const date = new Date(parseInt(timestamp) * 1000);
            return date.toLocaleDateString();
        }
        return timestamp; 
    }

    function fetchUserData() {
        if(!dns) return;
        const cleanDns = dns.replace(/^https?:\/\//, '');
        const apiURL = `http://${cleanDns}/player_api.php?username=${username}&password=${password}`;

        // Use Native HTTP if available
        if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp) {
             Capacitor.Plugins.CapacitorHttp.get({ url: apiURL }).then(response => {
                 if(response.data && response.data.user_info) {
                     fillData(response.data.user_info);
                 }
             }).catch(err => console.error(err));
        } else {
            // Fallback
            fetch(apiURL).then(res => res.json()).then(data => {
                if(data.user_info) fillData(data.user_info);
            });
        }
    }

    function fillData(info) {
        if(elUsername) elUsername.textContent = username;
        if(elStatus) {
            elStatus.textContent = info.status;
            elStatus.style.backgroundColor = (info.status === 'Active') ? '#10b981' : '#ef4444';
        }
        if(elExpiry) elExpiry.textContent = formatTime(info.exp_date);
        if(elMax) elMax.textContent = info.max_connections || "1";
        if(elActive) elActive.textContent = info.active_cons || "0";
        if(elTrial) elTrial.textContent = (info.is_trial === "1") ? "Yes" : "No";
        if(elCreated) elCreated.textContent = formatTime(info.created_at);
    }

    function updateFocus() {
        navItems.forEach((btn, idx) => {
            if(btn) {
                if (idx === focusIndex) {
                    btn.classList.add('focused');
                    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    btn.classList.remove('focused');
                }
            }
        });
    }
    
    setTimeout(updateFocus, 300);
});