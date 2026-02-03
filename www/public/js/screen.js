document.addEventListener('DOMContentLoaded', function () {
    console.log("Home Page Loaded");

    // --- 1. SETUP CLOCK & USER INFO ---
    const dateTimeEl = document.getElementById('date-time');
    const userEl = document.getElementById('user-info');
    const expEl = document.getElementById('expiration-info');

    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        if(dateTimeEl) dateTimeEl.textContent = `${timeStr} | ${dateStr}`;
    }
    setInterval(updateClock, 1000);
    updateClock();

    const username = localStorage.getItem('iptv_username') || 'Guest';
    const password = localStorage.getItem('iptv_password');
    const dns = localStorage.getItem('iptv_dns');

    if(userEl) userEl.textContent = `👤 ${username}`;

    if (username && password && dns) {
        const cleanDns = dns.replace(/^https?:\/\//, '');
        const apiURL = `http://${cleanDns}/player_api.php?username=${username}&password=${password}`;
        
        fetch(apiURL)
        .then(res => res.json())
        .then(data => {
            if (data.user_info && data.user_info.exp_date && expEl) {
                if (data.user_info.exp_date === "null" || !data.user_info.exp_date) {
                     expEl.textContent = `📅 Expires: Unlimited`;
                } else {
                    const date = new Date(parseInt(data.user_info.exp_date) * 1000);
                    expEl.textContent = `📅 Expires: ${date.toLocaleDateString()}`;
                }
            }
        }).catch(() => { if(expEl) expEl.textContent = `📅 Expires: Unknown`; });
    }

    // --- 2. NAVIGATION & CLICK LISTENERS ---
    // 🟢 FIX: Ensure we are looking for the new .nav-item class
    const navItems = Array.from(document.querySelectorAll('.nav-item'));
    let focusIndex = 0;

    navItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            focusIndex = index;
            updateFocus();
            handleAction();
        });
        item.addEventListener('focus', () => {
            focusIndex = index;
            updateFocus();
        });
        // 🟢 FIX: Hover support for Air Mouse
        item.addEventListener('mouseenter', () => {
            focusIndex = index;
            updateFocus();
        });
    });

    // Modal Variables
    let isExitModalOpen = false;
    let modalIndex = 1; 
    const btnYes = document.getElementById('confirm-yes');
    const btnNo = document.getElementById('confirm-no');

    if(btnYes) {
        btnYes.addEventListener('click', confirmExit);
        // 🟢 FIX: Add mouseenter for modal buttons too
        btnYes.addEventListener('mouseenter', () => { modalIndex = 0; updateFocus(); });
    }
    if(btnNo) {
        btnNo.addEventListener('click', closeExitModal);
        btnNo.addEventListener('mouseenter', () => { modalIndex = 1; updateFocus(); });
    }

    // --- 3. LOGIC ---
    function updateFocus() {
        if (isExitModalOpen) {
            // Modal Logic
            if(modalIndex === 0) { 
                btnYes.classList.add('focused'); 
                btnNo.classList.remove('focused'); 
                btnYes.focus(); 
            } else { 
                btnYes.classList.remove('focused'); 
                btnNo.classList.add('focused'); 
                btnNo.focus();
            }
        } else {
            // Main Grid Logic
            navItems.forEach((item, index) => {
                if (index === focusIndex) {
                    item.classList.add('focused');
                    item.focus(); // 🟢 IMPORTANT: Forces the browser to see it as active
                    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    item.classList.remove('focused');
                }
            });
        }
    }

    function openExitModal() {
        isExitModalOpen = true;
        modalIndex = 1;
        document.getElementById('exit-modal').style.display = 'flex';
        document.body.classList.add('modal-open');
        updateFocus();
    }

    function closeExitModal() {
        isExitModalOpen = false;
        document.getElementById('exit-modal').style.display = 'none';
        document.body.classList.remove('modal-open');
        // Return focus to the grid
        updateFocus();
    }

    function confirmExit() {
        if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
            Capacitor.Plugins.App.exitApp();
        } else {
            window.close();
        }
    }

    function handleAction() {
        const action = navItems[focusIndex].getAttribute('data-action');
        switch (action) {
            case 'live':   window.location.href = 'channels.html'; break;
            case 'movies': window.location.href = 'mvods.html'; break;
            case 'series': window.location.href = 'svods.html'; break;
            case 'reload': window.location.reload(); break;
            case 'account': window.location.href = 'account.html'; break;
            case 'exit':    openExitModal(); break;
        }
    }

    // --- 4. HARDWARE BACK BUTTON ---
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
            if (isExitModalOpen) {
                closeExitModal();
            } else {
                openExitModal();
            }
        });
    }

    // --- 5. KEYBOARD (TV Remote) ---
    // This logic is BETTER than remote.js for the home page 
    // because it handles the 2-Row Grid perfectly.
    document.addEventListener('keydown', function (e) {
        const keyCode = e.keyCode;

        // Modal Open
        if (isExitModalOpen) {
            if (keyCode === 37 || keyCode === 39) { // Left/Right
                modalIndex = (modalIndex === 0) ? 1 : 0;
                updateFocus();
            } else if (keyCode === 13 || keyCode === 23 || keyCode === 66) { // Enter/DPAD_CENTER
                if (modalIndex === 0) confirmExit(); else closeExitModal();
            } else if (keyCode === 10009 || keyCode === 27 || keyCode === 8) { // Back/Esc
                closeExitModal();
            }
            return;
        }

        // Main Grid Navigation
        if (keyCode === 37) { // Left
            // Wrap logic for 3 items per row
            if (focusIndex === 0) focusIndex = 2;
            else if (focusIndex === 3) focusIndex = 5;
            else focusIndex--;
        } else if (keyCode === 39) { // Right
            if (focusIndex === 2) focusIndex = 0;
            else if (focusIndex === 5) focusIndex = 3;
            else focusIndex++;
        } else if (keyCode === 40) { // Down
            if (focusIndex < 3) focusIndex += 3; // Jump to bottom row
        } else if (keyCode === 38) { // Up
            if (focusIndex >= 3) focusIndex -= 3; // Jump to top row
        } else if (keyCode === 13 || keyCode === 23 || keyCode === 66) { // Enter/DPAD_CENTER
            handleAction();
        } else if (keyCode === 10009 || keyCode === 8) { // Back
            openExitModal();
        }
        
        updateFocus();
    });

    // Init
    setTimeout(updateFocus, 300);
});