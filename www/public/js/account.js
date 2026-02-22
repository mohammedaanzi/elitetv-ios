document.addEventListener('DOMContentLoaded', function () {
    console.log("Account Module Engaged");

    const AccountController = {
        activeIndex: 0,
        interactiveElements: [
            document.getElementById('cmd-return'),
            document.getElementById('cmd-disconnect')
        ],
        
        uiClock: document.getElementById('view-clock'),
        uiUser: document.getElementById('val-username'),
        uiState: document.getElementById('val-status'),
        uiExpiry: document.getElementById('val-expiry'),
        uiMax: document.getElementById('val-max'),
        uiActive: document.getElementById('val-active'),
        uiTrial: document.getElementById('val-trial'),
        uiCreated: document.getElementById('val-created'),

        init: function() {
            this.startTimer();
            this.setupInteractions();
            this.setupHardwareBack();
            this.retrieveProfile();
            setTimeout(() => this.refreshHighlight(), 300);
        },

        startTimer: function() {
            const tick = () => {
                const now = new Date();
                if(this.uiClock) this.uiClock.textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            };
            setInterval(tick, 1000);
            tick();
        },

        setupInteractions: function() {
            // Button 1: Return
            if(this.interactiveElements[0]) {
                this.interactiveElements[0].addEventListener('click', () => {
                    window.location.href = 'screen.html';
                });
                this.interactiveElements[0].addEventListener('mouseenter', () => {
                    this.activeIndex = 0; this.refreshHighlight();
                });
            }

            // Button 2: Disconnect
            if(this.interactiveElements[1]) {
                this.interactiveElements[1].addEventListener('click', async () => {
                    localStorage.clear();
                    await this.wipeLocalCache();
                    window.location.href = 'index.html';
                });
                this.interactiveElements[1].addEventListener('mouseenter', () => {
                    this.activeIndex = 1; this.refreshHighlight();
                });
            }

            // TV Remote Keyboard Events
            document.addEventListener('keydown', (e) => {
                const key = e.keyCode;
                if (key === 37 || key === 38) { // Left or Up
                    if (this.activeIndex > 0) { this.activeIndex--; this.refreshHighlight(); }
                } else if (key === 39 || key === 40) { // Right or Down
                    if (this.activeIndex < this.interactiveElements.length - 1) { this.activeIndex++; this.refreshHighlight(); }
                } else if (key === 13 || key === 23 || key === 66) { // Enter
                    this.interactiveElements[this.activeIndex].click();
                } else if (key === 10009 || key === 8) { // Back key
                    window.location.href = 'screen.html';
                }
            });
        },

        setupHardwareBack: function() {
            if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
                Capacitor.Plugins.App.addListener('backButton', () => {
                    window.location.href = 'screen.html';
                });
            }
        },

        wipeLocalCache: function() {
            return new Promise((resolve) => {
                // Keep exact IndexedDB names intact so we successfully clear the cache
                indexedDB.deleteDatabase('DipPlayerDB');
                indexedDB.deleteDatabase('DipPlayerDB_V2');
                indexedDB.deleteDatabase('DipMoviesDB');
                
                setTimeout(() => {
                    console.log("Local Storage & DB Cache Wiped");
                    resolve();
                }, 500);
            });
        },

        formatTimestamp: function(ts) {
            if (!ts || ts === "null") return "Unlimited";
            if (!isNaN(ts)) {
                const d = new Date(parseInt(ts) * 1000);
                return d.toLocaleDateString();
            }
            return ts; 
        },

        retrieveProfile: function() {
            const usr = localStorage.getItem('iptv_username');
            const pwd = localStorage.getItem('iptv_password');
            const srv = localStorage.getItem('iptv_dns');

            if (!usr || !pwd) {
                window.location.href = 'index.html';
                return;
            }

            if(!srv) return;
            const cleanSrv = srv.replace(/^https?:\/\//, '');
            const endpoint = `http://${cleanSrv}/player_api.php?username=${usr}&password=${pwd}`;

            // Capacitor HTTP
            if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp) {
                 Capacitor.Plugins.CapacitorHttp.get({ url: endpoint }).then(res => {
                     if(res.data && res.data.user_info) this.injectData(res.data.user_info);
                 }).catch(err => console.error("Native API Error:", err));
            } else {
                // Browser Fallback
                fetch(endpoint).then(r => r.json()).then(payload => {
                    if(payload.user_info) this.injectData(payload.user_info);
                });
            }
        },

        injectData: function(data) {
            const rawUser = localStorage.getItem('iptv_username');
            if(this.uiUser) this.uiUser.textContent = rawUser;
            
            if(this.uiState) {
                this.uiState.textContent = data.status;
                if(data.status === 'Active') {
                    this.uiState.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
                    this.uiState.style.borderColor = '#10b981';
                    this.uiState.style.color = '#10b981';
                } else {
                    this.uiState.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                    this.uiState.style.borderColor = '#ef4444';
                    this.uiState.style.color = '#ef4444';
                }
            }
            
            if(this.uiExpiry) this.uiExpiry.textContent = this.formatTimestamp(data.exp_date);
            if(this.uiMax) this.uiMax.textContent = data.max_connections || "1";
            if(this.uiActive) this.uiActive.textContent = data.active_cons || "0";
            if(this.uiTrial) this.uiTrial.textContent = (data.is_trial === "1") ? "Yes" : "No";
            if(this.uiCreated) this.uiCreated.textContent = this.formatTimestamp(data.created_at);
        },

        refreshHighlight: function() {
            this.interactiveElements.forEach((el, idx) => {
                if(el) {
                    if (idx === this.activeIndex) {
                        el.classList.add('highlighted');
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        el.classList.remove('highlighted');
                    }
                }
            });
        }
    };

    AccountController.init();
});