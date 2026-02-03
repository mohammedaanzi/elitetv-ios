document.addEventListener('DOMContentLoaded', function () {
    console.log("Login Script Loaded");

    // --- VARIABLES ---
    const navItems = [
        document.getElementById('wrap-user'),      // 0
        document.getElementById('wrap-pass'),      // 1
        document.getElementById('toggle-password'),// 2
        document.getElementById('add-user')        // 3
    ];
    let focusIndex = 0;

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.getElementById('toggle-password');
    const loginBtn = document.getElementById('add-user');

    // --- CLICK LISTENERS ---
    if(navItems[0]) navItems[0].addEventListener('click', () => { handleTouch(0); });
    if(navItems[1]) navItems[1].addEventListener('click', () => { handleTouch(1); });
    
    if(toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleTouch(2);
        });
    }

    if(loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleTouch(3);
        });
    }

    // --- CORE FUNCTIONS ---
    function handleTouch(index) {
        focusIndex = index;
        updateFocus();
        triggerAction();
    }

    function updateFocus() {
        navItems.forEach(el => {
            if(el) el.classList.remove('focused');
        });
        const currentEl = navItems[focusIndex];
        if (currentEl) {
            currentEl.classList.add('focused');
            currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function triggerAction() {
        const currentEl = navItems[focusIndex];
        if (currentEl.classList.contains('input-wrapper')) {
            const inputId = currentEl.id === 'wrap-user' ? 'username' : 'password';
            const inputEl = document.getElementById(inputId);
            if (inputEl) inputEl.focus(); 
        } else if (currentEl.id === 'toggle-password') {
            togglePasswordLogic();
        } else if (currentEl.id === 'add-user') {
            login();
        }
    }

    function togglePasswordLogic() {
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            toggleBtn.style.opacity = "1";
        } else {
            passwordInput.type = 'password';
            toggleBtn.style.opacity = "0.6";
        }
    }

    // --- KEYBOARD & BACK BUTTON ---
    document.addEventListener('keydown', function (e) {
        
        // 🔴 FIX: If we are on TV, STOP here. 
        // We let the new "remote.js" handle the navigation to avoid Double Jumps.
        if (document.documentElement.classList.contains('tv-mode')) {
            return; 
        }

        const keyCode = e.keyCode;
        if (keyCode === 38) { // UP
            if (focusIndex > 0) { focusIndex--; updateFocus(); }
        } else if (keyCode === 40) { // DOWN
            if (focusIndex < navItems.length - 1) { focusIndex++; updateFocus(); }
        } else if (keyCode === 13) { // ENTER
            triggerAction();
        }
    });

    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
            if (!canGoBack) Capacitor.Plugins.App.exitApp();
            else window.history.back();
        });
    }

    // --- LOGIN LOGIC ---
    async function login() {
        const user = usernameInput.value.trim();
        const pass = passwordInput.value.trim();
        const loader = document.getElementById('loader');
        const errorBox = document.getElementById('error-box');

        if (!user || !pass) {
            showError('Please enter Username and Password.');
            return;
        }

        loader.style.display = 'flex';
        errorBox.style.display = 'none';

        const dnsList = await fetchDNSList();
        
        let workingDNS = null;
        for (const dns of dnsList) {
            const res = await testOneDNS(dns, user, pass);
            if (res) { workingDNS = res; break; }
        }

        if (workingDNS) {
            localStorage.setItem('iptv_username', user);
            localStorage.setItem('iptv_password', pass);
            localStorage.setItem('iptv_dns', workingDNS);
            window.location.href = 'screen.html';
        } else {
            loader.style.display = 'none';
            showError('Login Failed. Check credentials or internet.');
        }
    }

    function showError(msg) {
        const errorBox = document.getElementById('error-box');
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
        setTimeout(() => { errorBox.style.display = 'none'; }, 3000);
    }

    async function fetchDNSList() {
        try {
            const options = { url: 'https://panel.tvallstream.com/get_dns.php' };
            const response = await Capacitor.Plugins.CapacitorHttp.get(options);
            const data = response.data;
            return (data.success && Array.isArray(data.dns_list)) ? data.dns_list : [];
        } catch (err) {
            console.error("DNS Fetch Error (Native):", err);
            return [];
        }
    }

    async function testOneDNS(dns, username, password) {
        const cleanDns = dns.replace(/^https?:\/\//, '');
        const proxyTestURL = `http://${cleanDns}/player_api.php?username=${username}&password=${password}`;
        
        try {
            const options = { url: proxyTestURL, readTimeout: 8000, connectTimeout: 8000 };
            const response = await Capacitor.Plugins.CapacitorHttp.get(options);
            if (response.status === 200) {
                const data = response.data;
                if (data.user_info && data.user_info.auth == 1) return cleanDns;
            }
        } catch (err) {}
        return null;
    }

    setTimeout(updateFocus, 300);
});