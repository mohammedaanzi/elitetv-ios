document.addEventListener('DOMContentLoaded', function () {
    console.log("EPG Live Page Loaded");

    // ===== STATE =====
    let categories = [];
    let channels = [];
    let programs = [];
    let selectedCatId = null;
    let selectedChannelId = null;
    let selectedChannelName = '';

    // TV Navigation
    let currentZone = 'categories'; // categories | channels | programs | topbar
    let focusIndex = 0;

    // ===== IndexedDB CACHE (same pattern as channels.js) =====
    const DB_NAME = 'StreamCoreDB_V1';
    const STORE_CATS = 'folder_directories';
    const STORE_CHANNELS_CAT = 'broadcasts_by_folder';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_CATS)) db.createObjectStore(STORE_CATS);
                if (!db.objectStoreNames.contains(STORE_CHANNELS_CAT)) db.createObjectStore(STORE_CHANNELS_CAT);
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
    }

    async function getFromCache(store, key) {
        try {
            const db = await openDB();
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(store, 'readonly');
                const request = tx.objectStore(store).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
        } catch (e) { return null; }
    }

    async function saveToCache(store, key, data) {
        try {
            const db = await openDB();
            if (!db) return;
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(data, key);
        } catch (e) { }
    }

    // ===== API HELPERS =====
    function getApiBase() {
        const u = localStorage.getItem('iptv_username');
        const p = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        if (!u || !p || !dns) return null;
        const cleanDns = dns.replace(/^https?:\/\//, '');
        return { base: `http://${cleanDns}/player_api.php?username=${u}&password=${p}`, u, p, dns: cleanDns };
    }

    async function apiFetch(url) {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            const res = await Capacitor.Plugins.CapacitorHttp.get({ url: url });
            if (res.status === 200) return res.data;
            return null;
        } else {
            const res = await fetch(url);
            return await res.json();
        }
    }

    // ===== BUILD DOM =====
    const root = document.getElementById('app-root');
    root.innerHTML = `
      <div id="epg-wrapper">

        <!-- FULL-WIDTH TOP HEADER -->
        <header class="epg-top-header">
          <div class="epg-header-left">
            <button id="epg-back" class="epg-btn nav-item" type="button">← BACK</button>
            <button id="epg-refresh" class="epg-btn nav-item" type="button">↻ REFRESH</button>
          </div>
          <div class="epg-header-center">
            <span class="epg-now-channel" id="epg-channel-name">EPG LIVE</span>
          </div>
          <div class="epg-header-right">
            <span class="epg-clock" id="epg-clock">00:00</span>
            <span class="epg-current-date" id="epg-date"></span>
          </div>
        </header>

        <!-- ZONE INDICATOR BAR (full-width) -->
        <div id="epg-zone-bar">
          <span class="epg-zone-pill" data-zone="categories">Categories</span>
          <span class="epg-zone-pill" data-zone="channels">Channels</span>
          <span class="epg-zone-pill" data-zone="programs">Programs</span>
        </div>

        <!-- 3-PANEL CONTENT AREA -->
        <div id="epg-content-area">

          <!-- ZONE 1: Categories Sidebar -->
          <aside id="epg-categories">
            <h2 class="epg-sidebar-title">CATEGORIES</h2>
            <ul id="epg-cat-list">
              <li style="padding:16px; color:#555; font-size:0.85rem;">Loading...</li>
            </ul>
          </aside>

          <!-- ZONE 2: Channel List -->
          <div id="epg-channels">
            <div class="epg-channels-header">
              <span class="epg-channels-title">CHANNELS</span>
              <span class="epg-channels-count" id="epg-ch-count">0</span>
            </div>
            <div id="epg-channel-list">
              <div class="epg-empty-state">
                <svg class="epg-empty-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v14z"/></svg>
                <span class="epg-empty-desc">Select a category</span>
              </div>
            </div>
          </div>

          <!-- ZONE 3: EPG Programs Only -->
          <div id="epg-timeline">
            <div id="epg-programs">
              <div class="epg-empty-state">
                <svg class="epg-empty-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                <span class="epg-empty-title">Program Guide</span>
                <span class="epg-empty-desc">Select a channel to view its schedule</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    // ===== SETUP EVENTS =====
    document.getElementById('epg-back').onclick = () => window.location.href = 'screen.html';

    // REFRESH button — reloads EPG for current channel
    document.getElementById('epg-refresh').onclick = () => {
        if (selectedChannelId) loadEPG(selectedChannelId);
    };

    // ===== LIVE CLOCK =====
    function tickClock() {
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const clockEl = document.getElementById('epg-clock');
        if (clockEl) clockEl.textContent = time;
    }
    setInterval(tickClock, 1000);
    tickClock();

    // Show current date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('epg-date').textContent = dateStr;

    // ===== LOAD CATEGORIES =====
    async function loadCategories() {
        const api = getApiBase();
        if (!api) return;

        // Try cache first
        let data = await getFromCache(STORE_CATS, 'all_live_categories');

        if (!data) {
            try {
                data = await apiFetch(`${api.base}&action=get_live_categories`);
                if (data) await saveToCache(STORE_CATS, 'all_live_categories', data);
            } catch (err) { console.error('Failed to load categories:', err); }
        }

        if (data && data.length > 0) {
            categories = data;
            renderCategories();
            // Auto-select first category
            selectCategory(0);
        }
    }

    function renderCategories() {
        const list = document.getElementById('epg-cat-list');
        let html = '';
        categories.forEach((c, i) => {
            html += `<li class="epg-cat-item nav-item" data-idx="${i}" data-id="${c.category_id}" tabindex="-1">${c.category_name}</li>`;
        });
        list.innerHTML = html;

        // Click + hover events
        document.querySelectorAll('.epg-cat-item').forEach((el, idx) => {
            el.addEventListener('click', () => {
                currentZone = 'categories';
                focusIndex = idx;
                selectCategory(idx);
            });
            el.addEventListener('mouseenter', () => {
                currentZone = 'categories';
                focusIndex = idx;
                updateFocus();
            });
        });
    }

    function selectCategory(idx) {
        if (idx < 0 || idx >= categories.length) return;

        selectedCatId = categories[idx].category_id;

        // Highlight
        document.querySelectorAll('.epg-cat-item').forEach(el => el.classList.remove('active'));
        const items = document.querySelectorAll('.epg-cat-item');
        if (items[idx]) items[idx].classList.add('active');

        loadChannels(selectedCatId);
    }

    // ===== LOAD CHANNELS =====
    async function loadChannels(catId) {
        const api = getApiBase();
        if (!api) return;

        // Show loading
        document.getElementById('epg-channel-list').innerHTML = `
            <div class="epg-loader">
                <div class="epg-spinner"></div>
                <span class="epg-loader-text">Loading channels...</span>
            </div>`;
        document.getElementById('epg-ch-count').textContent = '0';

        // Try cache
        let data = await getFromCache(STORE_CHANNELS_CAT, `cat_${catId}`);

        if (!data) {
            try {
                data = await apiFetch(`${api.base}&action=get_live_streams&category_id=${catId}`);
                if (data) await saveToCache(STORE_CHANNELS_CAT, `cat_${catId}`, data);
            } catch (err) { console.error('Failed to load channels:', err); }
        }

        if (data && data.length > 0) {
            channels = data;
            renderChannels();
            // Auto-select first channel
            selectChannel(0);
        } else {
            channels = [];
            document.getElementById('epg-channel-list').innerHTML = `
                <div class="epg-empty-state">
                    <span class="epg-empty-desc">No channels in this category</span>
                </div>`;
            document.getElementById('epg-ch-count').textContent = '0';
        }
    }

    function renderChannels() {
        const list = document.getElementById('epg-channel-list');
        document.getElementById('epg-ch-count').textContent = channels.length;

        let html = '';
        channels.forEach((ch, i) => {
            const icon = ch.stream_icon || 'images/login-logo.png';
            html += `
                <div class="epg-channel-item nav-item" data-idx="${i}" data-id="${ch.stream_id}" tabindex="-1">
                    <img class="epg-ch-icon" src="${icon}" alt="" onerror="this.src='images/login-logo.png'">
                    <span class="epg-ch-name">${ch.name}</span>
                </div>`;
        });
        list.innerHTML = html;

        // Click + hover events
        document.querySelectorAll('.epg-channel-item').forEach((el, idx) => {
            el.addEventListener('click', () => {
                currentZone = 'channels';
                focusIndex = idx;
                selectChannel(idx);
            });
            el.addEventListener('mouseenter', () => {
                currentZone = 'channels';
                focusIndex = idx;
                updateFocus();
            });
        });
    }

    function selectChannel(idx) {
        if (idx < 0 || idx >= channels.length) return;

        const ch = channels[idx];
        selectedChannelId = ch.stream_id;
        selectedChannelName = ch.name;

        // Highlight
        document.querySelectorAll('.epg-channel-item').forEach(el => el.classList.remove('active'));
        const items = document.querySelectorAll('.epg-channel-item');
        if (items[idx]) items[idx].classList.add('active');

        // Update header
        document.getElementById('epg-channel-name').textContent = ch.name;

        loadEPG(ch.stream_id);
    }

    // ===== LOAD EPG DATA =====
    async function loadEPG(streamId) {
        const api = getApiBase();
        if (!api) return;

        // Show loading
        document.getElementById('epg-programs').innerHTML = `
            <div class="epg-loader">
                <div class="epg-spinner"></div>
                <span class="epg-loader-text">Loading program guide...</span>
            </div>`;

        try {
            // Try short EPG first (today's programs)
            const data = await apiFetch(`${api.base}&action=get_short_epg&stream_id=${streamId}&limit=50`);

            if (data && data.epg_listings && data.epg_listings.length > 0) {
                programs = data.epg_listings;
                renderPrograms();
            } else {
                // Try the simple data table as fallback
                const fullData = await apiFetch(`${api.base}&action=get_simple_data_table&stream_id=${streamId}`);

                if (fullData && fullData.epg_listings && fullData.epg_listings.length > 0) {
                    programs = fullData.epg_listings;
                    renderPrograms();
                } else {
                    programs = [];
                    document.getElementById('epg-programs').innerHTML = `
                        <div class="epg-empty-state">
                            <svg class="epg-empty-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                            <span class="epg-empty-title">No EPG Data</span>
                            <span class="epg-empty-desc">This channel does not have program guide information available</span>
                        </div>`;
                }
            }
        } catch (err) {
            console.error('EPG load error:', err);
            document.getElementById('epg-programs').innerHTML = `
                <div class="epg-empty-state">
                    <svg class="epg-empty-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                    <span class="epg-empty-title">Connection Error</span>
                    <span class="epg-empty-desc">Unable to load the program guide. Please try again.</span>
                </div>`;
        }
    }

    // ===== RENDER PROGRAMS =====
    function renderPrograms() {
        const container = document.getElementById('epg-programs');
        const nowTs = Math.floor(Date.now() / 1000);

        let html = '';
        let liveFound = false;

        programs.forEach((prog, i) => {
            // Decode base64 title and description if encoded
            let title = prog.title || 'Untitled';
            let desc = prog.description || '';

            try { title = decodeURIComponent(escape(atob(title))); } catch (e) { /* already plain text */ }
            try { desc = decodeURIComponent(escape(atob(desc))); } catch (e) { /* already plain text */ }

            // Parse times
            const startTs = parseInt(prog.start_timestamp) || 0;
            const endTs = parseInt(prog.stop_timestamp) || 0;

            const startDate = new Date(startTs * 1000);
            const endDate = new Date(endTs * 1000);

            const startTime = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTime = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Determine live / past / upcoming status
            const isLive = nowTs >= startTs && nowTs < endTs;
            const isPast = nowTs >= endTs;

            let stateClass = '';
            if (isLive) { stateClass = 'is-live'; liveFound = true; }
            else if (isPast) { stateClass = 'is-past'; }

            // Progress calculation
            let progressPct = 0;
            let elapsedStr = '';
            let remainStr = '';
            if (isLive && endTs > startTs) {
                const totalDur = endTs - startTs;
                const elapsed = nowTs - startTs;
                progressPct = Math.min(100, Math.round((elapsed / totalDur) * 100));
                elapsedStr = formatDuration(elapsed);
                remainStr = formatDuration(totalDur - elapsed);
            }

            html += `
                <div class="epg-program nav-item ${stateClass}" data-idx="${i}" tabindex="-1">
                    <div class="epg-program-top">
                        <span class="epg-program-title">${escapeHTML(title)}</span>
                        <span class="epg-live-badge"><span class="epg-live-dot"></span> LIVE</span>
                    </div>
                    <div class="epg-program-time">
                        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                        ${startTime} — ${endTime}
                    </div>
                    ${desc ? `<div class="epg-program-desc">${escapeHTML(desc)}</div>` : ''}
                    <div class="epg-progress-wrapper">
                        <div class="epg-progress-track">
                            <div class="epg-progress-fill" style="width:${progressPct}%"></div>
                        </div>
                        <div class="epg-progress-info">
                            <span class="epg-progress-text">${elapsedStr} elapsed</span>
                            <span class="epg-progress-text">${remainStr} remaining</span>
                        </div>
                    </div>
                </div>`;
        });

        container.innerHTML = html;

        // Click to expand/collapse description + hover
        document.querySelectorAll('.epg-program').forEach((el, idx) => {
            el.addEventListener('click', () => {
                el.classList.toggle('expanded');
            });
            el.addEventListener('mouseenter', () => {
                currentZone = 'programs';
                focusIndex = idx;
                updateFocus();
            });
        });

        // Scroll to live program
        if (liveFound) {
            setTimeout(() => {
                const liveEl = container.querySelector('.is-live');
                if (liveEl) liveEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 400);
        }

        // Update the progress bar every 30 seconds
        startProgressUpdater();
    }

    // ===== PROGRESS UPDATER =====
    let progressInterval = null;

    function startProgressUpdater() {
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(() => {
            const liveEl = document.querySelector('.epg-program.is-live');
            if (!liveEl) return;

            const idx = parseInt(liveEl.getAttribute('data-idx'));
            if (isNaN(idx) || !programs[idx]) return;

            const prog = programs[idx];
            const nowTs = Math.floor(Date.now() / 1000);
            const startTs = parseInt(prog.start_timestamp) || 0;
            const endTs = parseInt(prog.stop_timestamp) || 0;

            if (nowTs >= endTs) {
                // Program ended, reload EPG
                if (selectedChannelId) loadEPG(selectedChannelId);
                return;
            }

            const totalDur = endTs - startTs;
            const elapsed = nowTs - startTs;
            const pct = Math.min(100, Math.round((elapsed / totalDur) * 100));

            const fill = liveEl.querySelector('.epg-progress-fill');
            const texts = liveEl.querySelectorAll('.epg-progress-text');

            if (fill) fill.style.width = pct + '%';
            if (texts[0]) texts[0].textContent = formatDuration(elapsed) + ' elapsed';
            if (texts[1]) texts[1].textContent = formatDuration(totalDur - elapsed) + ' remaining';
        }, 30000);
    }

    // ===== HELPERS =====
    function formatDuration(seconds) {
        if (seconds < 0) seconds = 0;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ===== KEYBOARD / TV REMOTE NAVIGATION =====
    function updateZoneIndicator() {
        document.querySelectorAll('.epg-zone-pill').forEach(pill => {
            pill.classList.toggle('active', pill.getAttribute('data-zone') === currentZone);
        });
    }

    function updateFocus() {
        document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        updateZoneIndicator();

        let selector = '';
        if (currentZone === 'categories') selector = '#epg-cat-list .epg-cat-item';
        else if (currentZone === 'channels') selector = '#epg-channel-list .epg-channel-item';
        else if (currentZone === 'programs') selector = '#epg-programs .epg-program';
        else if (currentZone === 'topbar') selector = '.epg-top-header .nav-item';

        if (selector) {
            const items = document.querySelectorAll(selector);
            if (items.length > 0) {
                if (focusIndex >= items.length) focusIndex = items.length - 1;
                if (focusIndex < 0) focusIndex = 0;
                const target = items[focusIndex];
                target.classList.add('focused');
                target.focus();
                target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        }
    }

    document.addEventListener('keydown', function (e) {
        const code = e.keyCode;
        if ([37, 38, 39, 40].includes(code)) e.preventDefault();

        if (currentZone === 'categories') {
            if (code === 38) focusIndex--;       // Up
            else if (code === 40) focusIndex++;  // Down
            else if (code === 39) {              // Right → go to channels
                currentZone = 'channels';
                focusIndex = 0;
            }
            else if (code === 13 || code === 23 || code === 66) { // Enter / DPAD_CENTER
                const items = document.querySelectorAll('#epg-cat-list .epg-cat-item');
                if (items[focusIndex]) {
                    items[focusIndex].click();
                }
            }
        }
        else if (currentZone === 'channels') {
            if (code === 38) focusIndex--;       // Up
            else if (code === 40) focusIndex++;  // Down
            else if (code === 37) {              // Left → go to categories
                currentZone = 'categories';
                const cats = document.querySelectorAll('.epg-cat-item');
                const activeIdx = Array.from(cats).findIndex(c => c.classList.contains('active'));
                focusIndex = activeIdx > -1 ? activeIdx : 0;
            }
            else if (code === 39) {              // Right → go to programs
                currentZone = 'programs';
                // Focus on the live program if exists, otherwise first
                const liveEl = document.querySelector('.epg-program.is-live');
                if (liveEl) {
                    focusIndex = parseInt(liveEl.getAttribute('data-idx')) || 0;
                } else {
                    focusIndex = 0;
                }
            }
            else if (code === 13 || code === 23 || code === 66) { // Enter / DPAD_CENTER
                const items = document.querySelectorAll('#epg-channel-list .epg-channel-item');
                if (items[focusIndex]) {
                    items[focusIndex].click();
                }
            }
        }
        else if (currentZone === 'programs') {
            if (code === 38) focusIndex--;       // Up
            else if (code === 40) focusIndex++;  // Down
            else if (code === 37) {              // Left → go to channels
                currentZone = 'channels';
                const chs = document.querySelectorAll('.epg-channel-item');
                const activeIdx = Array.from(chs).findIndex(c => c.classList.contains('active'));
                focusIndex = activeIdx > -1 ? activeIdx : 0;
            }
            else if (code === 13 || code === 23 || code === 66) { // Enter / DPAD_CENTER
                const items = document.querySelectorAll('#epg-programs .epg-program');
                if (items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'topbar') {
            if (code === 40) {                   // Down → go to categories
                currentZone = 'categories';
                focusIndex = 0;
            }
            else if (code === 13 || code === 23 || code === 66) { // Enter / DPAD_CENTER
                const items = document.querySelectorAll('.epg-top-header .nav-item');
                if (items[focusIndex]) items[focusIndex].click();
            }
        }

        // Back key
        if (code === 10009 || code === 27 || code === 8) {
            window.location.href = 'screen.html';
        }

        updateFocus();
    });

    // ===== Capacitor back button =====
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('backButton', () => {
            window.location.href = 'screen.html';
        });
    }

    // ===== START =====
    loadCategories();

    // Initial focus for TV mode (slight delay for DOM rendering)
    setTimeout(() => updateFocus(), 300);
});
