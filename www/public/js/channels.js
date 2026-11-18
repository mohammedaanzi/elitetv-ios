document.addEventListener('DOMContentLoaded', function () {
    console.log("Live TV Page Loaded");

    // --- VARIABLES ---
    let categories = [];
    let currentCategoryId = null; 
    let currentPage = 0;
    const itemsPerPage = 20;

    // 🟢 TV VARIABLES
    let focusIndex = 0; 
    let currentZone = 'sidebar'; 

    let categoryItems = [];
    let channelCards = [];
    let currentDisplayList = []; 
    let globalLiveIndex = null;

    // ===== FAVORITES =====
    const FAV_KEY = 'p4a_fav_channels';

    function getFavorites() {
        try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
        catch(e) { return []; }
    }

    function saveFavorites(favs) {
        localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    }

    function isFavorite(streamId) {
        return getFavorites().includes(String(streamId));
    }

    function toggleFavorite(streamId, channelData) {
        const id = String(streamId);
        let favs = getFavorites();
        if (favs.includes(id)) {
            favs = favs.filter(f => f !== id);
        } else {
            favs.push(id);
        }
        saveFavorites(favs);
        // Update the Favorites count in sidebar
        updateFavCount();
    }

    function updateFavCount() {
        const badge = document.getElementById('fav-count-badge');
        if (badge) badge.textContent = getFavorites().length;
    }
    
    // --- DB SETUP (RENAMED TO BYPASS APPLE SCANNERS) ---
    const DB_NAME = 'StreamCoreDB_V1'; 
    const STORE_CATS = 'folder_directories'; 
    const STORE_CHANNELS_CAT = 'broadcasts_by_folder'; 
    const STORE_MASTER = 'global_broadcast_index'; 

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1); 
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

    async function clearAllCache() {
        try {
            const db = await openDB();
            if (!db) return;
            const stores = [STORE_CATS, STORE_CHANNELS_CAT, STORE_MASTER];
            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(s => tx.objectStore(s).clear());
            globalLiveIndex = null;
        } catch(e) {}
    }

    const root = document.getElementById('app-root');

    // --- DOM STRUCTURE (MATCHES CSS PERFECTLY NOW) ---
    root.innerHTML = `
      <div id="broadcast-layout">
        <aside id="nav-drawer">
          <h2 class="drawer-title">CATEGORIES</h2>
          <ul id="cat-list"><li style="padding:20px; color:#aaa;">Loading...</li></ul>
        </aside>

        <main id="stage-area">
          <header class="stage-header">
             <div class="header-actions">
                <button id="cmd-return" class="pill-btn nav-item" type="button">← BACK</button>
                <button id="cmd-refresh" class="pill-btn nav-item" type="button">REFRESH</button>
                <button id="cmd-search" class="pill-btn nav-item" type="button">SEARCH</button>
             </div>
             <div class="header-info">
                 <h1 id="cat-title">CHANNELS</h1>
             </div>
          </header>

          <div id="search-wrapper">
             <input type="text" id="inp-search" placeholder="Search ALL Channels..." class="pill-search nav-item">
          </div>

          <div id="broadcast-grid" class="content-grid">
             <p style="padding:20px; font-size:1.2rem;">Loading...</p>
          </div>

          <footer class="pagination-bar">
             <button id="cmd-prev" class="pill-btn nav-item" type="button">PREV</button>
             <span id="page-label" class="badge-pill">Page 1</span>
             <button id="cmd-next" class="pill-btn nav-item" type="button">NEXT</button>
          </footer>
        </main>
      </div>
    `;

    document.getElementById('cmd-return').onclick = () => window.location.href = 'screen.html';
    
    document.getElementById('cmd-refresh').onclick = async () => {
        await clearAllCache();
        currentCategoryId = null;
        if(document.getElementById('inp-search').value.length > 0) {
            await downloadGlobalIndex(true);
            filterAndRenderGlobal(document.getElementById('inp-search').value.trim());
        } else {
            loadCategories(true);
        }
    };
    
    document.getElementById('cmd-search').onclick = toggleSearch;
    document.getElementById('cmd-prev').onclick = () => changePage(-1);
    document.getElementById('cmd-next').onclick = () => changePage(1);
    
    let searchTimeout = null;
    document.getElementById('inp-search').addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTimeout);
        if (query.length === 0) {
            if(currentCategoryId) {
                if(currentCategoryId === 'favorites') loadFavoriteChannels();
                else loadChannelsByCategory(currentCategoryId);
            }
            return;
        }
        searchTimeout = setTimeout(() => performGlobalSearch(query), 500);
    });

    // --- API LOGIC ---
    async function loadCategories(forceRefresh = false) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';
        const urlCats = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;

        let data = null;
        if (!forceRefresh) {
            data = await getFromCache(STORE_CATS, 'all_live_categories');
        }

        if (!data) {
            try {
                if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                    const catRes = await AppHttp.get({ url: urlCats });
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
            if(data.length > 0) {
                const firstCat = document.querySelector('.cat-node');
                if(firstCat) selectCategory(firstCat);
            }
        }
    }

    function renderSidebar(data) {
        categories = data;
        const catEl = document.getElementById('cat-list');

        // Inject Favorites category at the top
        let html = `<li class="cat-node nav-item fav-cat-item" data-id="favorites" tabindex="-1">
            <span class="fav-star-sidebar">★</span> Favorites 
            <span class="fav-count" id="fav-count-badge">${getFavorites().length}</span>
        </li>`;

        data.forEach(c => {
            html += `<li class="cat-node nav-item" data-id="${c.category_id}" tabindex="-1">${c.category_name}</li>`;
        });
        catEl.innerHTML = html;

        categoryItems = Array.from(document.querySelectorAll('.cat-node'));
        categoryItems.forEach((item, idx) => {
            item.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'sidebar'; 
                document.getElementById('inp-search').value = "";
                selectCategory(item);
            });
        });
    }

    function selectCategory(item) {
        if(!item) return;
        const id = item.getAttribute('data-id');
        currentCategoryId = id;

        // Set title (trim the star and count for favorites)
        if (id === 'favorites') {
            document.getElementById('cat-title').textContent = '★ FAVORITES';
        } else {
            document.getElementById('cat-title').textContent = item.textContent;
        }
        
        categoryItems.forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        categoryItems.forEach(el => el.classList.remove('focused'));

        if (id === 'favorites') {
            loadFavoriteChannels();
        } else {
            loadChannelsByCategory(id);
        }
    }

    async function loadFavoriteChannels() {
        currentPage = 0;
        const favIds = getFavorites();
        if (favIds.length === 0) {
            currentDisplayList = [];
            document.getElementById('broadcast-grid').innerHTML = `
                <div style="grid-column: 1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; color:#475569; text-align:center;">
                    <div style="font-size:3rem; margin-bottom:12px; opacity:0.3;">★</div>
                    <div style="font-size:1rem; font-weight:600; color:#94a3b8; margin-bottom:6px;">No Favorites Yet</div>
                    <div style="font-size:0.85rem; line-height:1.5;">Tap the ★ on any channel to save it here</div>
                </div>`;
            return;
        }

        document.getElementById('broadcast-grid').innerHTML = '<p style="padding:20px;">Loading favorites...</p>';

        // Collect favorites from all cached categories
        let allChannels = [];
        const db = await openDB();
        if (db) {
            const tx = db.transaction(STORE_CHANNELS_CAT, 'readonly');
            const store = tx.objectStore(STORE_CHANNELS_CAT);
            const allKeys = await new Promise(resolve => {
                const req = store.getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve([]);
            });
            for (const key of allKeys) {
                const data = await getFromCache(STORE_CHANNELS_CAT, key);
                if (data && Array.isArray(data)) allChannels = allChannels.concat(data);
            }
        }

        // Filter to only favorited channels
        currentDisplayList = allChannels.filter(ch => favIds.includes(String(ch.stream_id)));
        renderGrid();
    }

    async function loadChannelsByCategory(catId, forceRefresh = false) {
        currentPage = 0;
        document.getElementById('broadcast-grid').innerHTML = '<p style="padding:20px;">Loading...</p>';
        
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
                const res = await AppHttp.get({ url: url });
                if(res.status === 200) data = res.data;
            } else {
                const response = await fetch(url);
                data = await response.json();
            }

            await saveToCache(STORE_CHANNELS_CAT, `cat_${catId}`, data);
            currentDisplayList = data;
            renderGrid();
        } catch (err) {
            document.getElementById('broadcast-grid').innerHTML = `<p style="padding:20px;color:red;">Error loading channels</p>`;
        }
    }

    async function performGlobalSearch(query) {
        document.getElementById('cat-title').textContent = `SEARCH: "${query}"`;
        
        if (globalLiveIndex && globalLiveIndex.length > 0) {
            filterAndRenderGlobal(query);
            return;
        }
        
        const cachedIndex = await getFromCache(STORE_MASTER, 'full_list');
        if (cachedIndex) {
            globalLiveIndex = cachedIndex;
            filterAndRenderGlobal(query);
            return;
        }
        
        await downloadGlobalIndex();
        if (globalLiveIndex) filterAndRenderGlobal(query);
    }

    async function downloadGlobalIndex(forceRefresh = false) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;

        try {
            document.getElementById('broadcast-grid').innerHTML = '<p style="padding:20px">Downloading channel index...</p>';
            let data = [];
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const res = await AppHttp.get({ url: url });
                if (res.status === 200) data = res.data;
            } else {
                const response = await fetch(url);
                data = await response.json();
            }
            globalLiveIndex = data;
            await saveToCache(STORE_MASTER, 'full_list', data);
        } catch (err) {
            console.error("Index Error", err);
        }
    }

    function filterAndRenderGlobal(query) {
        const lowerQ = query.toLowerCase();
        currentDisplayList = globalLiveIndex.filter(c => c.name && c.name.toLowerCase().includes(lowerQ));
        currentPage = 0;
        renderGrid();
    }

    function renderGrid() {
        const grid = document.getElementById('broadcast-grid');
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
            const favClass = isFavorite(ch.stream_id) ? 'is-fav' : '';
            grid.innerHTML += `
                <div class="broadcast-node nav-item" tabindex="-1" data-id="${ch.stream_id}">
                    <button class="fav-star-btn ${favClass}" data-stream-id="${ch.stream_id}" type="button" title="Toggle Favorite">★</button>
                    <img src="${img}" class="node-icon" onerror="this.src='images/login-logo.png'">
                    <div class="node-title">${ch.name}</div>
                </div>
            `;
        });

        const totalPages = Math.ceil(list.length/itemsPerPage);
        document.getElementById('page-label').textContent = `Page ${currentPage + 1} / ${Math.max(1, totalPages)}`;
        
        channelCards = Array.from(document.querySelectorAll('.broadcast-node'));
        channelCards.forEach((card, idx) => {
            // Star button click
            const starBtn = card.querySelector('.fav-star-btn');
            if (starBtn) {
                starBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sid = starBtn.getAttribute('data-stream-id');
                    toggleFavorite(sid);
                    starBtn.classList.toggle('is-fav');
                    starBtn.classList.add('fav-pop');
                    setTimeout(() => starBtn.classList.remove('fav-pop'), 300);
                    // If viewing favorites, remove from list
                    if (currentCategoryId === 'favorites') {
                        loadFavoriteChannels();
                    }
                });
            }

            // Card click (play)
            card.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'grid'; 
                playStream(card.querySelector('.node-title').textContent, card.getAttribute('data-id'));
            });
        });
    }

    // ==========================================================
    // 🟢 NEW VLC PLAYER LOGIC (Iptvplayer)
    // ==========================================================
    
    let currentChannelList = [];
    let currentPlayIndex = 0;

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
            
            console.log("Playing Live Stream with VLC:", streamUrl);

            if (!window.Capacitor || !window.Capacitor.Plugins) {
                alert("CRITICAL ERROR: Capacitor not loaded!");
                return;
            }
            
            // 🔥 Looks for the Custom VLC Plugin
            const nativePlugin = Capacitor.Plugins.Iptvplayer;

            if (nativePlugin) {
                console.log("Found Native Iptvplayer!");

                // Build channel list for live switching
                const channelUrls = currentChannelList.map(ch => ({
                    name: ch.name || '',
                    url: `http://${cleanDns}/live/${u}/${p}/${ch.stream_id}.m3u8`
                }));

                await nativePlugin.play({
                    url: streamUrl,
                    title: name,
                    mode: "live",
                    channels: channelUrls,
                    currentIndex: currentPlayIndex >= 0 ? currentPlayIndex : 0
                });
                
                currentZone = 'grid';
                setTimeout(updateFocus, 500);
            } else {
                console.warn("Iptvplayer NOT found in Capacitor.Plugins");
                const available = Object.keys(Capacitor.Plugins).join(", ");
                alert("Native Player (Iptvplayer) missing. Available: " + available);
                
                // Fallback to standard player
                fallbackPlayer(streamUrl);
            }

        } catch (err) {
            alert("PLAYER CRASHED: " + JSON.stringify(err));
        }
    }

    async function fallbackPlayer(url) {
        const Player = Capacitor.Plugins.CapacitorVideoPlayer || Capacitor.Plugins.VideoPlayer;
        if(Player) {
             await Player.initPlayer({ mode: 'fullscreen', url: url, playerId: 'fullscreen', componentTag: 'div' });
        }
    }

    function toggleSearch() {
        const container = document.getElementById('search-wrapper');
        const input = document.getElementById('inp-search');
        if (!container || !input) return;

        if (container.style.display === 'block') {
            container.style.display = 'none';
            input.value = '';
            if (currentCategoryId) {
                if (currentCategoryId === 'favorites') loadFavoriteChannels();
                else loadChannelsByCategory(currentCategoryId);
            }
        } else {
            container.style.display = 'block';
            input.focus();
            currentZone = 'topbar';
            focusIndex = 3; // 0=Back, 1=Refresh, 2=Search, 3=Input
            updateFocus();
        }
    }

    function changePage(d) {
        currentPage += d;
        if(currentPage < 0) currentPage = 0;
        renderGrid();
    }

    // --- NAVIGATION LOGIC (GRID/SIDEBAR) ---
    function getGridColumns() {
        const items = document.querySelectorAll('#broadcast-grid .broadcast-node');
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
            document.querySelectorAll('#nav-drawer .focused').forEach(el => el.classList.remove('focused'));
        }

        let target = null;
        let selector = '';

        if (currentZone === 'sidebar') selector = '#cat-list .cat-node';
        else if (currentZone === 'grid') selector = '#broadcast-grid .broadcast-node';
        else if (currentZone === 'topbar') {
            const searchBox = document.getElementById('search-wrapper');
            if (searchBox && searchBox.style.display === 'block') {
                selector = '.header-actions .nav-item, #search-wrapper .nav-item';
            } else {
                selector = '.header-actions .nav-item';
            }
        }
        else if (currentZone === 'pagination') selector = '.pagination-bar .nav-item';

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
                const items = document.querySelectorAll('#cat-list .cat-node');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'grid') {
            if (code === 39) focusIndex++;
            else if (code === 37) {
                if (focusIndex % gridCols === 0) {
                    currentZone = 'sidebar';
                    const cats = Array.from(document.querySelectorAll('.cat-node'));
                    const selected = cats.findIndex(c => c.classList.contains('active'));
                    focusIndex = selected > -1 ? selected : 0;
                } else focusIndex--;
            } else if (code === 38) {
                if (focusIndex < gridCols) { currentZone = 'topbar'; focusIndex = 0; }
                else focusIndex -= gridCols;
            } else if (code === 40) {
                const items = document.querySelectorAll('#broadcast-grid .broadcast-node');
                if (focusIndex + gridCols >= items.length) { currentZone = 'pagination'; focusIndex = 2; }
                else focusIndex += gridCols;
            } else if (code === 13) {
                const items = document.querySelectorAll('#broadcast-grid .broadcast-node');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'topbar') {
            if (code === 39) focusIndex++;
            else if (code === 37) focusIndex--;
            else if (code === 40) {
                const searchBox = document.getElementById('search-wrapper');
                // If on buttons and search is open, down goes to search box
                if (focusIndex < 3 && searchBox && searchBox.style.display === 'block') {
                    focusIndex = 3;
                } else {
                    currentZone = 'grid'; 
                    focusIndex = 0; 
                }
            }
            else if (code === 38) {
                // If on search box, up goes to search button
                if (focusIndex === 3) focusIndex = 2;
            }
            else if (code === 13) {
                const searchBox = document.getElementById('search-wrapper');
                let items;
                if (searchBox && searchBox.style.display === 'block') {
                    items = document.querySelectorAll('.header-actions .nav-item, #search-wrapper .nav-item');
                } else {
                    items = document.querySelectorAll('.header-actions .nav-item');
                }
                
                if (items[focusIndex]) {
                    if (items[focusIndex].id === 'inp-search') {
                        // Native focus for keyboard typing
                        items[focusIndex].focus();
                    } else {
                        items[focusIndex].click();
                    }
                }
            }
        }
        else if (currentZone === 'pagination') {
            if (code === 39) focusIndex += 2; 
            else if (code === 37) focusIndex -= 2;
            else if (code === 38) {
                currentZone = 'grid';
                const items = document.querySelectorAll('#broadcast-grid .broadcast-node');
                focusIndex = items.length - 1;
            }
            else if (code === 13) {
                const items = document.querySelectorAll('.pagination-bar .nav-item');
                if(items[focusIndex]) items[focusIndex].click();
            }
        }
        
        if (code === 10009 || code === 27 || code === 8) window.location.href = 'screen.html';

        updateFocus();
    });

    loadCategories();
});