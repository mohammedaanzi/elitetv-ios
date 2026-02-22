document.addEventListener('DOMContentLoaded', function () {
    console.log("Dashboard Core Initialized");

    const DashboardManager = {
        activeNodeId: 0,
        interactiveNodes: Array.from(document.querySelectorAll('.interactive-node')),
        overlayActive: false,
        dialogCursor: 1, 
        
        uiClock: document.getElementById('system-clock'),
        uiProfile: document.getElementById('profile-status'),
        uiSub: document.getElementById('sub-status'),
        btnConfirm: document.getElementById('action-yes'),
        btnCancel: document.getElementById('action-no'),

        init: function() {
            this.startClock();
            this.fetchProfileData();
            this.setupInteractions();
            this.setupHardwareKeys();
            setTimeout(() => this.renderHighlight(), 300);
        },

        startClock: function() {
            const tick = () => {
                const now = new Date();
                const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                if(this.uiClock) this.uiClock.textContent = `${time} | ${date}`;
            };
            setInterval(tick, 1000);
            tick();
        },

        fetchProfileData: function() {
            const usr = localStorage.getItem('iptv_username') || 'Guest';
            const pwd = localStorage.getItem('iptv_password');
            const srv = localStorage.getItem('iptv_dns');

            if(this.uiProfile) this.uiProfile.textContent = `👤 ${usr}`;

            if (usr && pwd && srv) {
                const cleanSrv = srv.replace(/^https?:\/\//, '');
                const endpoint = `http://${cleanSrv}/player_api.php?username=${usr}&password=${pwd}`;
                
                fetch(endpoint)
                .then(r => r.json())
                .then(payload => {
                    if (payload.user_info && payload.user_info.exp_date && this.uiSub) {
                        if (payload.user_info.exp_date === "null" || !payload.user_info.exp_date) {
                             this.uiSub.textContent = `📅 Status: Unlimited`;
                        } else {
                            const d = new Date(parseInt(payload.user_info.exp_date) * 1000);
                            this.uiSub.textContent = `📅 Valid till: ${d.toLocaleDateString()}`;
                        }
                    }
                }).catch(() => { if(this.uiSub) this.uiSub.textContent = `📅 Status: Unknown`; });
            }
        },

        setupInteractions: function() {
            this.interactiveNodes.forEach((node, idx) => {
                node.addEventListener('click', () => {
                    this.activeNodeId = idx;
                    this.renderHighlight();
                    this.executeRoute();
                });
                node.addEventListener('focus', () => {
                    this.activeNodeId = idx;
                    this.renderHighlight();
                });
                node.addEventListener('mouseenter', () => {
                    this.activeNodeId = idx;
                    this.renderHighlight();
                });
            });

            if(this.btnConfirm) {
                this.btnConfirm.addEventListener('click', () => this.terminateApp());
                this.btnConfirm.addEventListener('mouseenter', () => { this.dialogCursor = 0; this.renderHighlight(); });
            }
            if(this.btnCancel) {
                this.btnCancel.addEventListener('click', () => this.hideDialog());
                this.btnCancel.addEventListener('mouseenter', () => { this.dialogCursor = 1; this.renderHighlight(); });
            }
        },

        renderHighlight: function() {
            if (this.overlayActive) {
                if(this.dialogCursor === 0) { 
                    this.btnConfirm.classList.add('highlighted'); 
                    this.btnCancel.classList.remove('highlighted'); 
                    this.btnConfirm.focus(); 
                } else { 
                    this.btnConfirm.classList.remove('highlighted'); 
                    this.btnCancel.classList.add('highlighted'); 
                    this.btnCancel.focus();
                }
            } else {
                this.interactiveNodes.forEach((node, idx) => {
                    if (idx === this.activeNodeId) {
                        node.classList.add('highlighted');
                        node.focus(); 
                        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        node.classList.remove('highlighted');
                    }
                });
            }
        },

        showDialog: function() {
            this.overlayActive = true;
            this.dialogCursor = 1;
            document.getElementById('quit-overlay').style.display = 'flex';
            document.body.classList.add('overlay-active');
            this.renderHighlight();
        },

        hideDialog: function() {
            this.overlayActive = false;
            document.getElementById('quit-overlay').style.display = 'none';
            document.body.classList.remove('overlay-active');
            this.renderHighlight();
        },

        terminateApp: function() {
            if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
                Capacitor.Plugins.App.exitApp();
            } else {
                window.close();
            }
        },

        executeRoute: function() {
            const route = this.interactiveNodes[this.activeNodeId].getAttribute('data-route');
            switch (route) {
                case 'live':   window.location.href = 'channels.html'; break;
                case 'movies': window.location.href = 'mvods.html'; break;
                case 'series': window.location.href = 'svods.html'; break;
                case 'reload': window.location.reload(); break;
                case 'account': window.location.href = 'account.html'; break;
                case 'exit':    this.showDialog(); break;
            }
        },

        setupHardwareKeys: function() {
            if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
                Capacitor.Plugins.App.addListener('backButton', () => {
                    if (this.overlayActive) this.hideDialog();
                    else this.showDialog();
                });
            }

            document.addEventListener('keydown', (e) => {
                const key = e.keyCode;

                if (this.overlayActive) {
                    if (key === 37 || key === 39) { // L/R
                        this.dialogCursor = (this.dialogCursor === 0) ? 1 : 0;
                        this.renderHighlight();
                    } else if (key === 13 || key === 23 || key === 66) { // Enter
                        if (this.dialogCursor === 0) this.terminateApp(); else this.hideDialog();
                    } else if (key === 10009 || key === 27 || key === 8) { // Back
                        this.hideDialog();
                    }
                    return;
                }

                // Grid Math (3 items per row)
                if (key === 37) { // Left
                    if (this.activeNodeId === 0) this.activeNodeId = 2;
                    else if (this.activeNodeId === 3) this.activeNodeId = 5;
                    else this.activeNodeId--;
                } else if (key === 39) { // Right
                    if (this.activeNodeId === 2) this.activeNodeId = 0;
                    else if (this.activeNodeId === 5) this.activeNodeId = 3;
                    else this.activeNodeId++;
                } else if (key === 40) { // Down
                    if (this.activeNodeId < 3) this.activeNodeId += 3;
                } else if (key === 38) { // Up
                    if (this.activeNodeId >= 3) this.activeNodeId -= 3; 
                } else if (key === 13 || key === 23 || key === 66) { // Enter
                    this.executeRoute();
                } else if (key === 10009 || key === 8) { // Back
                    this.showDialog();
                }
                
                this.renderHighlight();
            });
        }
    };

    DashboardManager.init();
});