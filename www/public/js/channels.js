document.addEventListener('DOMContentLoaded', function () {
    console.log("Live TV Page Loaded");

    // --- VARIABLES ---
    let categories = [];
    let currentCategoryId = null; // Removed default 'favorites'
    let currentPage = 0;
    const itemsPerPage = 20;

    // 🟢 TV VARIABLES
    let focusIndex = 0; 
    let currentZone = 'sidebar'; 

    // 🟢 Player Variables
    let isPlayerActive = false;

    let categoryItems = [];
    let channelCards = [];
    let currentDisplayList = []; 
    
    // --- DB SETUP (Removed Favorites Store) ---
    const DB_NAME = 'DipPlayerDB_V2';
    const STORE_CATS = 'live_categories';
    const STORE_CHANNELS_CAT = 'live_streams_by_cat'; 
    const STORE_MASTER = 'live_master_index'; 

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 7); // Incremented version to clear old schemas
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_CATS)) db.createObjectStore(STORE_CATS);
                if (!db.objectStoreNames.contains(STORE_CHANNELS_CAT)) db.createObjectStore(STORE_CHANNELS_CAT);
                if (!db.objectStoreNames.contains(STORE_MASTER)) db.createObjectStore(STORE_MASTER);
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => { resolve(null); }; 
        });
    }

    async function saveToCache(store, key, data) {
        try {
            const db = await openDB();
            if(!db) return;
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(data, key);
        } catch(e) {}
    }

    async function getFromCache(store, key) {
        try {
            const db = await openDB();
            if(!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(store, 'readonly');
                const request = tx.objectStore(store).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });
        } catch(e) { return null; }
    }

    const root = document.getElementById('app-root');

    // --- DOM STRUCTURE ---
    root.innerHTML = `
      <div class="live-wrapper">
        <aside class="sidebar">
          <h2>Categories</h2>
          <ul id="category-list"><li style="padding:20px; color:#aaa;">Loading...</li></ul>
        </aside>

        <main class="channel-pane">
          <header class="top-bar">
             <div class="top-actions">
                <button id="back-btn" class="nav-btn nav-item" type="button">←Home</button>
                <button id="refresh-btn" class="nav-btn nav-item" type="button">Refresh</button>
                <button id="search-btn" class="nav-btn nav-item" type="button">Search</button>
             </div>
             <div class="header-info">
                 <h1 id="cat-title">Channels</h1>
             </div>
          </header>

          <div id="search-container" style="display:none;">
             <input type="text" id="search-input" placeholder="Search ALL Channels..." class="search-input nav-item">
          </div>

          <div id="channel-grid" class="grid">
             <p style="padding:20px; font-size:1.2rem;">Loading...</p>
          </div>

          <footer class="pagination-controls">
             <button id="prev-btn" class="nav-btn nav-item" type="button">Prev</button>
             <span id="page-info" style="margin: 0 20px; font-size: 1.1rem;">Page 1</span>
             <button id="next-btn" class="nav-btn nav-item" type="button">Next</button>
          </footer>
        </main>
      </div>
    `;

    document.getElementById('back-btn').onclick = () => window.location.href = 'screen.html';
    
    document.getElementById('refresh-btn').onclick = () => {
        if(document.getElementById('search-input').value.length > 0) {
            downloadGlobalIndex(true);
        } else if(currentCategoryId) {
            loadChannelsByCategory(currentCategoryId, true);
        } else {
            loadCategories(true);
        }
    };
    
    document.getElementById('search-btn').onclick = toggleSearch;
    document.getElementById('prev-btn').onclick = () => changePage(-1);
    document.getElementById('next-btn').onclick = () => changePage(1);
    
    let searchTimeout = null;
    document.getElementById('search-input').addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTimeout);
        if (query.length === 0) {
            if(currentCategoryId) loadChannelsByCategory(currentCategoryId);
            return;
        }
        searchTimeout = setTimeout(() => performGlobalSearch(query), 500);
    });

    // --- API LOGIC ---
    async function loadCategories(forceRefresh = false) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        
        // Removed Login Check Redirect
        
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';
        const urlCats = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;

        let data = null;
        if (!forceRefresh) {
            data = await getFromCache(STORE_CATS, 'all_live_categories');
        }

        if (!data) {
            try {
                if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                    const catRes = await Capacitor.Plugins.CapacitorHttp.get({ url: urlCats });
                    if (catRes.status === 200) data = catRes.data;
                } else {
                    const response = await fetch(urlCats);
                    data = await response.json();
                }
                
                if (data) await saveToCache(STORE_CATS, 'all_live_categories', data);
            } catch (err) { console.error(err); }
        }

        if (data) {
            renderSidebar(data);
            // Select First Category by Default
            if(data.length > 0) {
                const firstCat = document.querySelector('.category-item');
                if(firstCat) selectCategory(firstCat);
            }
        }
    }

    function renderSidebar(data) {
        categories = data;
        const catEl = document.getElementById('category-list');
        // Removed Favorites LI
        let html = ``; 
        data.forEach(c => {
            html += `<li class="category-item nav-item" data-id="${c.category_id}" tabindex="-1">${c.category_name}</li>`;
        });
        catEl.innerHTML = html;

        categoryItems = Array.from(document.querySelectorAll('.category-item'));
        categoryItems.forEach((item, idx) => {
            item.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'sidebar'; 
                document.getElementById('search-input').value = "";
                selectCategory(item);
            });
        });
    }

    function selectCategory(item) {
        if(!item) return;
        const id = item.getAttribute('data-id');
        currentCategoryId = id;
        document.getElementById('cat-title').textContent = item.textContent;
        
        categoryItems.forEach(el => el.classList.remove('selected-cat'));
        item.classList.add('selected-cat');
        categoryItems.forEach(el => el.classList.remove('focused'));

        loadChannelsByCategory(id);
    }

    async function loadChannelsByCategory(catId, forceRefresh = false) {
        currentPage = 0;
        document.getElementById('channel-grid').innerHTML = '<p style="padding:20px;">Loading...</p>';
        
        if (!forceRefresh) {
            const cached = await getFromCache(STORE_CHANNELS_CAT, `cat_${catId}`);
            if (cached) {
                currentDisplayList = cached;
                renderGrid();
                return;
            }
        }

        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_live_streams&category_id=${catId}`;

        try {
            let data = [];
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const res = await Capacitor.Plugins.CapacitorHttp.get({ url: url });
                if(res.status === 200) data = res.data;
            } else {
                const response = await fetch(url);
                data = await response.json();
            }

            await saveToCache(STORE_CHANNELS_CAT, `cat_${catId}`, data);
            currentDisplayList = data;
            renderGrid();
        } catch (err) {
            document.getElementById('channel-grid').innerHTML = `<p style="padding:20px;color:red;">Error loading channels</p>`;
        }
    }

    async function downloadGlobalIndex() {
        // Global search logic would go here
    }

    function performGlobalSearch(query) {
       // Search filter logic
    }

    function renderGrid() {
        const grid = document.getElementById('channel-grid');
        grid.innerHTML = '';
        
        let list = currentDisplayList;
        if(!list || list.length === 0) {
            grid.innerHTML = '<p style="padding:20px">No channels found.</p>';
            return;
        }

        const start = currentPage * itemsPerPage;
        const pagedList = list.slice(start, start + itemsPerPage);

        pagedList.forEach(ch => {
            const img = ch.stream_icon || 'images/login-logo.png'; 
            // Removed Favorite Logic and Icon
            grid.innerHTML += `
                <div class="channel-card nav-item" tabindex="-1" data-id="${ch.stream_id}">
                    <img src="${img}" onerror="this.src='images/login-logo.png'">
                    <div class="ch-name">${ch.name}</div>
                </div>
            `;
        });

        const totalPages = Math.ceil(list.length/itemsPerPage);
        document.getElementById('page-info').textContent = `Page ${currentPage + 1} / ${Math.max(1, totalPages)}`;
        
        channelCards = Array.from(document.querySelectorAll('.channel-card'));
        channelCards.forEach((card, idx) => {
            card.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'grid'; 
                playStream(card.querySelector('.ch-name').textContent, card.getAttribute('data-id'));
            });
            // Removed Long Press Event
        });
    }

    // ==========================================================
    // 🟢 NEW CAPACITOR NATIVE PLAYER LOGIC (iOS Only)
    // ==========================================================
    
    let currentChannelList = [];
    let currentPlayIndex = 0;

    // 🟢 UPDATED: Auto-detects the correct Plugin Name
    async function playStream(name, streamId) {
        try {
            currentChannelList = currentDisplayList; 
            currentPlayIndex = currentChannelList.findIndex(ch => String(ch.stream_id) === String(streamId));

            const u = localStorage.getItem('iptv_username');
            const p = localStorage.getItem('iptv_password');
            const dnsRaw = localStorage.getItem('iptv_dns');

            if (!u || !p || !dnsRaw) {
                alert("Error: Missing Login Data");
                return;
            }

            const cleanDns = dnsRaw.replace(/^https?:\/\//, '');
            const streamUrl = `http://${cleanDns}/live/${u}/${p}/${streamId}.m3u8`;
            
            console.log("Stream URL:", streamUrl);

            if (!window.Capacitor) {
                alert("CRITICAL ERROR: Capacitor not loaded!");
                return;
            }
            
            // 🟢 FIX: Check BOTH names (Yours is showing up as 'VideoPlayer')
            const CapacitorVideoPlayer = Capacitor.Plugins.CapacitorVideoPlayer || Capacitor.Plugins.VideoPlayer;

            if (!CapacitorVideoPlayer) {
                // If still missing, show the list again
                const installed = Object.keys(window.Capacitor.Plugins);
                alert("CRITICAL ERROR: Native Player Plugin MISSING! Found: " + JSON.stringify(installed));
                return;
            }

            await CapacitorVideoPlayer.initPlayer({
                mode: 'fullscreen',
                url: streamUrl,
                playerId: 'fullscreen',
                componentTag: 'div',
                ios: {
                    itemType: "live",
                    httpHeaders: {
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
                    }
                }
            });
            
            isPlayerActive = true;

        } catch (err) {
            alert("PLAYER CRASHED: " + JSON.stringify(err));
        }
    }

    // 3. Close Player
    async function closePlayer() {
        if (window.Capacitor && Capacitor.isNativePlatform()) {
            const CapacitorVideoPlayer = Capacitor.Plugins.CapacitorVideoPlayer;
            await CapacitorVideoPlayer.stopAllPlayers();
        }
    }

    function toggleSearch() {
        const container = document.getElementById('search-container');
        if (container.style.display === 'block') container.style.display = 'none';
        else container.style.display = 'block';
    }

    function changePage(d) {
        currentPage += d;
        if(currentPage < 0) currentPage = 0;
        renderGrid();
    }

    // 🟢 RESUME LISTENER
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('resume', () => {
            console.log("App Resumed - Player Closed");
            if (isPlayerActive) {
                isPlayerActive = false;
                currentZone = 'grid';
                if(document.activeElement) document.activeElement.blur();
                setTimeout(updateFocus, 200);
            }
        });
    }

    // --- NAVIGATION LOGIC (GRID/SIDEBAR) ---
    function getGridColumns() {
        const items = document.querySelectorAll('#channel-grid .channel-card');
        if (items.length < 2) return 1;
        const firstTop = items[0].getBoundingClientRect().top;
        for(let i = 1; i < items.length; i++) {
            if (items[i].getBoundingClientRect().top > firstTop + 10) return i;
        }
        return items.length;
    }

    function updateFocus() {
        document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        document.body.setAttribute('data-zone', currentZone);

        if (currentZone === 'grid') {
            document.querySelectorAll('.sidebar .focused').forEach(el => el.classList.remove('focused'));
        }

        let target = null;
        let selector = '';

        if (currentZone === 'sidebar') selector = '#category-list .category-item';
        else if (currentZone === 'grid') selector = '#channel-grid .channel-card';
        else if (currentZone === 'topbar') selector = '.top-actions .nav-item';
        else if (currentZone === 'pagination') selector = '.pagination-controls .nav-item';

        if (selector) {
            const items = document.querySelectorAll(selector);
            if(items.length > 0) {
                if(focusIndex >= items.length) focusIndex = items.length - 1;
                if(focusIndex < 0) focusIndex = 0;
                target = items[focusIndex];
            }
        }

        if (target) {
            target.classList.add('focused');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }

    document.addEventListener('keydown', function(e) {
        const code = e.keyCode;
        const gridCols = getGridColumns(); 
        if([37,38,39,40].includes(code)) e.preventDefault();

        if (currentZone === 'sidebar') {
            if (code === 38) focusIndex--;
            else if (code === 40) focusIndex++;
            else if (code === 39) { currentZone = 'grid'; focusIndex = 0; }
            else if (code === 13) {
                const items = document.querySelectorAll('#category-list .category-item');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'grid') {
            if (code === 39) focusIndex++;
            else if (code === 37) {
                if (focusIndex % gridCols === 0) {
                    currentZone = 'sidebar';
                    const cats = Array.from(document.querySelectorAll('.category-item'));
                    const selected = cats.findIndex(c => c.classList.contains('selected-cat'));
                    focusIndex = selected > -1 ? selected : 0;
                } else focusIndex--;
            } else if (code === 38) {
                if (focusIndex < gridCols) { currentZone = 'topbar'; focusIndex = 0; }
                else focusIndex -= gridCols;
            } else if (code === 40) {
                const items = document.querySelectorAll('#channel-grid .channel-card');
                if (focusIndex + gridCols >= items.length) { currentZone = 'pagination'; focusIndex = 2; }
                else focusIndex += gridCols;
            } else if (code === 13) {
                const items = document.querySelectorAll('#channel-grid .channel-card');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'topbar') {
            if (code === 39) focusIndex++;
            else if (code === 37) focusIndex--;
            else if (code === 40) { currentZone = 'grid'; focusIndex = 0; }
            else if (code === 13) {
                const items = document.querySelectorAll('.top-actions .nav-item');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'pagination') {
            if (code === 39) focusIndex += 2; 
            else if (code === 37) focusIndex -= 2;
            else if (code === 38) {
                currentZone = 'grid';
                const items = document.querySelectorAll('#channel-grid .channel-card');
                focusIndex = items.length - 1;
            }
            else if (code === 13) {
                const items = document.querySelectorAll('.pagination-controls .nav-item');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        
        if (code === 10009 || code === 27 || code === 8) window.location.href = 'screen.html';

        updateFocus();
    });

    loadCategories();
});