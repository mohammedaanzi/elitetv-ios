document.addEventListener('DOMContentLoaded', function () {
    console.log("Auth Module Initialized");

    const AuthManager = {
        activeIndex: 0,
        authNodes: [
            document.getElementById('node-user'),      // 0
            document.getElementById('node-pass'),      // 1
            document.getElementById('node-toggle'),    // 2
            document.getElementById('node-submit')     // 3
        ],
        uiUser: document.getElementById('iptv-user'),
        uiPass: document.getElementById('iptv-pass'),
        uiToggle: document.getElementById('node-toggle'),
        uiSubmit: document.getElementById('node-submit'),
        
        init: function() {
            this.setupTouchEvents();
            this.setupKeyboardEvents();
            this.setupCapacitorEvents();
            setTimeout(() => this.refreshHighlight(), 300);
        },

        setupTouchEvents: function() {
            if(this.authNodes[0]) this.authNodes[0].addEventListener('click', () => this.handleNodeSelect(0));
            if(this.authNodes[1]) this.authNodes[1].addEventListener('click', () => this.handleNodeSelect(1));
            
            if(this.uiToggle) {
                this.uiToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleNodeSelect(2);
                });
            }

            if(this.uiSubmit) {
                this.uiSubmit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleNodeSelect(3);
                });
            }
        },

        handleNodeSelect: function(index) {
            this.activeIndex = index;
            this.refreshHighlight();
            this.fireNodeAction();
        },

        refreshHighlight: function() {
            this.authNodes.forEach(node => {
                if(node) node.classList.remove('highlighted');
            });
            const currentNode = this.authNodes[this.activeIndex];
            if (currentNode) {
                currentNode.classList.add('highlighted');
                currentNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },

        fireNodeAction: function() {
            const currentNode = this.authNodes[this.activeIndex];
            if (currentNode.classList.contains('field-container')) {
                const targetId = currentNode.id === 'node-user' ? 'iptv-user' : 'iptv-pass';
                const inputField = document.getElementById(targetId);
                if (inputField) inputField.focus(); 
            } else if (currentNode.id === 'node-toggle') {
                this.toggleVisibility();
            } else if (currentNode.id === 'node-submit') {
                this.executeAuthentication();
            }
        },

        toggleVisibility: function() {
            if (this.uiPass.type === 'password') {
                this.uiPass.type = 'text';
                this.uiToggle.style.opacity = "1";
            } else {
                this.uiPass.type = 'password';
                this.uiToggle.style.opacity = "0.7";
            }
        },

        setupKeyboardEvents: function() {
            document.addEventListener('keydown', (e) => {
                if (document.documentElement.classList.contains('tv-mode')) return; 

                const key = e.keyCode;
                if (key === 38) { // UP
                    if (this.activeIndex > 0) { this.activeIndex--; this.refreshHighlight(); }
                } else if (key === 40) { // DOWN
                    if (this.activeIndex < this.authNodes.length - 1) { this.activeIndex++; this.refreshHighlight(); }
                } else if (key === 13) { // ENTER
                    this.fireNodeAction();
                }
            });
        },

        setupCapacitorEvents: function() {
            if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
                Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
                    if (!canGoBack) Capacitor.Plugins.App.exitApp();
                    else window.history.back();
                });
            }
        },

        // --- BACKEND LOGIC ---
        executeAuthentication: async function() {
            // UPDATED: Changed from 'const' to 'let' so we can modify them
            let usr = this.uiUser.value.trim();
            let pwd = this.uiPass.value.trim();
            
            const loaderScreen = document.getElementById('auth-loader');
            const alertBox = document.getElementById('alert-box');

            if (!usr || !pwd) {
                this.displayAlert('Please enter your Username and Password.');
                return;
            }

            // 🟢 NEW: DEMO/TEST ACCOUNT INTERCEPTOR
            // If the user types 'apptest' for both, we swap them out for the real credentials
            if (usr.toLowerCase() === 'apptest' && pwd.toLowerCase() === 'apptest') {
                console.log("Demo Account Detected. Engaging hidden credentials.");
                usr = 'normal';
                pwd = 'demo';
            }

            loaderScreen.style.display = 'flex';
            alertBox.style.display = 'none';

            const serverList = await this.retrieveServers();
            
            let activeServer = null;
            for (const srv of serverList) {
                const valid = await this.pingServer(srv, usr, pwd);
                if (valid) { activeServer = valid; break; }
            }

            if (activeServer) {
                // Because we swapped the variables above, the REAL credentials ('normal' & 'demo') 
                // will be saved securely into localStorage so the rest of the app works flawlessly.
                localStorage.setItem('iptv_username', usr);
                localStorage.setItem('iptv_password', pwd);
                localStorage.setItem('iptv_dns', activeServer);
                window.location.href = 'screen.html';
            } else {
                loaderScreen.style.display = 'none';
                this.displayAlert('Authentication Failed. Verify credentials or connection.');
            }
        },

        displayAlert: function(message) {
            const alertBox = document.getElementById('alert-box');
            alertBox.textContent = message;
            alertBox.style.display = 'block';
            setTimeout(() => { alertBox.style.display = 'none'; }, 3500);
        },

        retrieveServers: async function() {
            try {
                const reqOptions = { url: 'https://panel.tvallstream.com/get_dns.php' };
                const res = await Capacitor.Plugins.CapacitorHttp.get(reqOptions);
                const payload = res.data;
                return (payload.success && Array.isArray(payload.dns_list)) ? payload.dns_list : [];
            } catch (err) {
                console.error("Native Fetch Failed:", err);
                return [];
            }
        },

        pingServer: async function(url, u, p) {
            const cleanUrl = url.replace(/^https?:\/\//, '');
            const testEndpoint = `http://${cleanUrl}/player_api.php?username=${u}&password=${p}`;
            
            try {
                const reqOptions = { url: testEndpoint, readTimeout: 8000, connectTimeout: 8000 };
                const res = await Capacitor.Plugins.CapacitorHttp.get(reqOptions);
                if (res.status === 200) {
                    const payload = res.data;
                    if (payload.user_info && payload.user_info.auth == 1) return cleanUrl;
                }
            } catch (err) {}
            return null;
        }
    };

    // Initialize the module
    AuthManager.init();
});