/* www/js/remote.js */

(function() {
    console.log("📺 TV Remote Script Loaded");

    // 1. Define the Navigation Logic
    window.initRemoteNavigation = function() {
        console.log("🎮 Remote Navigation Active");

        // Select all things we want to click (buttons, inputs, cards)
        const selector = '.nav-item'; 
        let items = Array.from(document.querySelectorAll(selector));
        
        if (!items.length) {
            console.warn("⚠️ No .nav-item elements found to focus.");
            return;
        }

        let focusIndex = 0;

        // --- Helper: Highlight the current item ---
        function updateFocus() {
            // Re-scan DOM in case content changed (like after login)
            items = Array.from(document.querySelectorAll(selector));
            
            // Safety checks
            if (items.length === 0) return;
            if (focusIndex >= items.length) focusIndex = items.length - 1;
            if (focusIndex < 0) focusIndex = 0;

            // Loop through all items
            items.forEach((el, i) => {
                if (i === focusIndex) {
                    el.classList.add('focused');
                    el.focus();
                    // Smooth scroll helps on TV if the list is long
                    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                } else {
                    el.classList.remove('focused');
                }
            });
        }

        // --- Event Listener: Listen for Remote Keys ---
        document.addEventListener('keydown', (e) => {
            if (!items.length) return;

            const code = e.keyCode;
            
            // Log key code to help you debug (visible in Android Studio Logcat)
            // console.log("Key Pressed: " + code);

            switch (code) {
                case 40: // Arrow Down
                case 39: // Arrow Right
                    // Move Next
                    focusIndex = (focusIndex + 1) % items.length;
                    updateFocus();
                    break;

                case 38: // Arrow Up
                case 37: // Arrow Left
                    // Move Previous
                    focusIndex = (focusIndex - 1 + items.length) % items.length;
                    updateFocus();
                    break;

                case 13: // Enter (OK Button)
                case 23: // DPAD_CENTER (Some Android TVs)
                case 66: // DPAD_CENTER (Others)
                    if(items[focusIndex]) {
                        // Trigger a real click
                        items[focusIndex].click();
                        
                        // If it's an input field, force focus so keyboard opens
                        if (items[focusIndex].tagName === 'INPUT') {
                            items[focusIndex].focus();
                        }
                    }
                    break;
            }
        });

        // --- Event Listener: Hover support (Hybrid) ---
        // If user uses a mouse/air-mouse, update the focus index
        items.forEach((el, index) => {
            el.addEventListener('mouseenter', () => {
                focusIndex = index;
                updateFocus(); // Update visual but don't steal focus hard
            });
        });

        // Start with the first item focused
        setTimeout(updateFocus, 300);
    };

    // 2. Handle the Back Button (Capacitor Way, No Imports)
    // We wait for deviceready just to be safe
    document.addEventListener('deviceready', function() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            
            window.Capacitor.Plugins.App.addListener('backButton', function() {
                // If we are on the Home Page, Exit the App
                if (window.location.href.indexOf("screen.html") > -1) {
                    window.Capacitor.Plugins.App.exitApp();
                } else {
                    // Otherwise, just go back one page
                    window.history.back();
                }
            });
            
        }
    });

    // 3. AUTO-START THE SCRIPT
    // This makes sure it runs immediately after being loaded by index.html/screen.html
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.initRemoteNavigation);
    } else {
        window.initRemoteNavigation();
    }

})();