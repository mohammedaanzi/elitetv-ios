document.addEventListener('DOMContentLoaded', function () {
    console.log("Series Page Loaded");

    // --- VARIABLES ---
    let categories = []; 
    let currentCategoryId = 'favorites'; 
    let currentPage = 0;
    const itemsPerPage = 20;

    // TV Variables
    let focusIndex = 0;
    let currentZone = 'sidebar';

    let inEpisodeView = false;
    let categoryItems = [];
    let cardItems = [];
    let favoriteSeriesIds = [];
    let currentSeriesList = []; 
    let currentEpisodes = []; 
    let globalSeriesIndex = null;
    let longPressTimer;
    const longPressDuration = 800;

    const root = document.getElementById('app-root');

    // --- DB SETUP ---
    const DB_NAME = 'DipPlayerDB_V2';
    const STORE_CATS = 'series_categories';
    const STORE_SERIES_CAT = 'series_by_cat';
    const STORE_MASTER = 'series_master_index';
    const STORE_SERIES_FAV_OBJECTS = 'series_favorites_objects';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 10); 
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_CATS)) db.createObjectStore(STORE_CATS);
                if (!db.objectStoreNames.contains(STORE_SERIES_CAT)) db.createObjectStore(STORE_SERIES_CAT);
                if (!db.objectStoreNames.contains(STORE_MASTER)) db.createObjectStore(STORE_MASTER);
                if (!db.objectStoreNames.contains(STORE_SERIES_FAV_OBJECTS)) db.createObjectStore(STORE_SERIES_FAV_OBJECTS, { keyPath: "series_id" }); 
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => resolve(null);
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

    async function addFavoriteObject(seriesData) {
        try {
            seriesData.series_id = String(seriesData.series_id);
            const db = await openDB();
            if(!db) return;
            const tx = db.transaction(STORE_SERIES_FAV_OBJECTS, 'readwrite');
            tx.objectStore(STORE_SERIES_FAV_OBJECTS).put(seriesData);
        } catch(e) {}
    }

    async function removeFavoriteObject(seriesId) {
        try {
            const db = await openDB();
            if(!db) return;
            const tx = db.transaction(STORE_SERIES_FAV_OBJECTS, 'readwrite');
            tx.objectStore(STORE_SERIES_FAV_OBJECTS).delete(String(seriesId));
        } catch(e) {}
    }

    async function getAllFavoriteObjects() {
        try {
            const db = await openDB();
            if(!db) return [];
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_SERIES_FAV_OBJECTS, 'readonly');
                const request = tx.objectStore(STORE_SERIES_FAV_OBJECTS).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });
        } catch(e) { return []; }
    }

    function loadFavorites() {
        try {
            const saved = localStorage.getItem('iptv_favorites_series');
            if (saved) favoriteSeriesIds = JSON.parse(saved);
        } catch (e) { favoriteSeriesIds = []; }
    }
    loadFavorites();

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
                <button id="back-btn" class="nav-btn nav-item" type="button">← Home</button>
                <button id="refresh-btn" class="nav-btn nav-item" type="button">Refresh</button>
                <button id="search-btn" class="nav-btn nav-item" type="button">Search</button>
             </div>
             <div class="header-info">
                 <h1 id="cat-title">Favorites</h1>
             </div>
          </header>

          <div id="search-container">
             <input type="text" id="search-input" placeholder="Search ALL Series..." class="search-input nav-item">
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

    document.getElementById('back-btn').onclick = () => handleBack();
    document.getElementById('refresh-btn').onclick = () => {
        const searchInput = document.getElementById('search-input');
        if(searchInput && searchInput.value.length > 0) downloadGlobalIndex(true);
        else if (currentCategoryId === 'favorites') loadSeriesByCategory('favorites', true);
        else loadSeriesByCategory(currentCategoryId, true);
    };
    document.getElementById('search-btn').onclick = toggleSearch;
    document.getElementById('prev-btn').onclick = () => changePage(-1);
    document.getElementById('next-btn').onclick = () => changePage(1);
    
    let searchTimeout = null;
    const searchInput = document.getElementById('search-input');
    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchTimeout);
            if (query.length === 0) {
                if(currentCategoryId) loadSeriesByCategory(currentCategoryId);
                return;
            }
            searchTimeout = setTimeout(() => performGlobalSearch(query), 500);
        });
    }

    // --- LOGIC FUNCTIONS ---
    async function loadCategories(forceRefresh = false) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const cleanDns = localStorage.getItem('iptv_dns').replace(/^https?:\/\//, '');
        const urlCats = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_series_categories`;

        let data = null;
        if (!forceRefresh) data = await getFromCache(STORE_CATS, 'all_series_categories');
        if (!data) {
            try {
                if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                    const res = await Capacitor.Plugins.CapacitorHttp.get({ url: urlCats });
                    if(res.status===200) data = res.data;
                } else {
                    const res = await fetch(urlCats);
                    data = await res.json();
                }
                await saveToCache(STORE_CATS, 'all_series_categories', data);
            } catch (err) {}
        }
        if (data) {
            renderSidebar(data);
            let targetBtn = null;
            if (currentCategoryId) targetBtn = document.querySelector(`.category-item[data-id="${currentCategoryId}"]`);
            if (!targetBtn) targetBtn = document.querySelector('.category-item[data-id="favorites"]');
            if (targetBtn) selectCategory(targetBtn, true); 
        }
    }

    function renderSidebar(data) {
        const catEl = document.getElementById('category-list');
        categories = data;
        let html = `<li class="category-item nav-item" data-id="favorites" tabindex="-1">⭐ Favorites</li>`;
        data.forEach(c => html += `<li class="category-item nav-item" data-id="${c.category_id}" tabindex="-1">${c.category_name}</li>`);
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
        setTimeout(updateFocus, 200);
    }
    
    function selectCategory(item, isAutoLoad = false) {
        if(!item) return;
        const id = item.getAttribute('data-id');
        currentCategoryId = id;
        document.getElementById('cat-title').textContent = item.textContent;
        categoryItems.forEach(el => el.classList.remove('selected-cat'));
        item.classList.add('selected-cat');
        if(!isAutoLoad) { currentZone = 'sidebar'; updateFocus(); }
        loadSeriesByCategory(id);
    }

    async function loadSeriesByCategory(catId, forceRefresh = false) {
        inEpisodeView = false;
        currentPage = 0;
        document.getElementById('channel-grid').innerHTML = '<p style="padding:20px;">Loading...</p>';
        
        if (catId === 'favorites') {
            currentSeriesList = await getAllFavoriteObjects();
            if (currentSeriesList.length === 0) document.getElementById('channel-grid').innerHTML = '<p style="padding:20px;">No favorites yet.</p>';
            else renderSeriesGrid();
            return;
        }

        if (!forceRefresh) {
            const cached = await getFromCache(STORE_SERIES_CAT, `cat_${catId}`);
            if (cached) {
                currentSeriesList = cached;
                renderSeriesGrid();
                return;
            }
        }

        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const cleanDns = localStorage.getItem('iptv_dns').replace(/^https?:\/\//, '');
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_series&category_id=${catId}`;

        try {
            let data;
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const res = await Capacitor.Plugins.CapacitorHttp.get({ url: url });
                data = res.data;
            } else {
                const res = await fetch(url);
                data = await res.json();
            }
            await saveToCache(STORE_SERIES_CAT, `cat_${catId}`, data);
            currentSeriesList = data;
            renderSeriesGrid();
        } catch (err) {
            document.getElementById('channel-grid').innerHTML = `<p style="padding:20px;color:red;">Error: ${err.message}</p>`;
        }
    }

    async function performGlobalSearch(query) {
        document.getElementById('cat-title').textContent = `Search: "${query}"`;
        inEpisodeView = false;
        if (globalSeriesIndex && globalSeriesIndex.length > 0) { filterAndRenderGlobal(query); return; }
        const cached = await getFromCache(STORE_MASTER, 'full_list');
        if (cached) { globalSeriesIndex = cached; filterAndRenderGlobal(query); return; }
        await downloadGlobalIndex();
        if (globalSeriesIndex) filterAndRenderGlobal(query);
    }

    async function downloadGlobalIndex() {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const cleanDns = localStorage.getItem('iptv_dns').replace(/^https?:\/\//, '');
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_series`;
        try {
            const res = await Capacitor.Plugins.CapacitorHttp.get({ url: url });
            if(res.status === 200) {
                globalSeriesIndex = res.data;
                await saveToCache(STORE_MASTER, 'full_list', res.data);
            }
        } catch (err) { console.error("Index Error", err); }
    }

    function filterAndRenderGlobal(query) {
        const lowerQ = query.toLowerCase();
        currentSeriesList = globalSeriesIndex.filter(s => s.name && s.name.toLowerCase().includes(lowerQ));
        currentPage = 0;
        renderSeriesGrid();
    }

    function renderSeriesGrid() {
        const grid = document.getElementById('channel-grid');
        grid.innerHTML = '';
        if(currentSeriesList.length === 0) { grid.innerHTML = '<p style="padding:20px">No series found.</p>'; return; }
        const start = currentPage * itemsPerPage;
        const pagedList = currentSeriesList.slice(start, start + itemsPerPage);
        
        pagedList.forEach(s => {
            const img = s.cover || s.stream_icon || 'images/login-logo.png'; 
            const isFav = favoriteSeriesIds.includes(String(s.series_id));
            const favIcon = isFav ? '<span class="fav-icon">⭐</span>' : '';
            const dataJson = encodeURIComponent(JSON.stringify(s));
            grid.innerHTML += `<div class="channel-card nav-item" tabindex="-1" data-id="${s.series_id}" data-obj="${dataJson}">${favIcon}<img src="${img}" onerror="this.src='images/login-logo.png'"><div class="ch-name">${s.name}</div></div>`;
        });
        
        document.getElementById('page-info').textContent = `Page ${currentPage + 1} / ${Math.max(1, Math.ceil(currentSeriesList.length/itemsPerPage))}`;
        
        cardItems = Array.from(document.querySelectorAll('.channel-card'));
        cardItems.forEach((card, idx) => {
            card.addEventListener('click', () => { focusIndex = idx; currentZone = 'grid'; loadEpisodes(card.getAttribute('data-id')); });
            const handleFav = () => { toggleFavorite(JSON.parse(decodeURIComponent(card.getAttribute('data-obj')))); };
            card.addEventListener('touchstart', (e) => { longPressTimer = setTimeout(handleFav, 800); });
            card.addEventListener('touchend', () => clearTimeout(longPressTimer));
        });
        if (currentZone === 'grid') updateFocus();
    }

    async function toggleFavorite(seriesObj) {
        if(navigator.vibrate) navigator.vibrate(50);
        const id = String(seriesObj.series_id);
        const index = favoriteSeriesIds.indexOf(id);
        if (index > -1) {
            favoriteSeriesIds.splice(index, 1);
            await removeFavoriteObject(id);
        } else {
            favoriteSeriesIds.push(id);
            await addFavoriteObject(seriesObj);
        }
        localStorage.setItem('iptv_favorites_series', JSON.stringify(favoriteSeriesIds));
        if (currentCategoryId === 'favorites') loadSeriesByCategory('favorites', true);
        else renderSeriesGrid(); 
    }

    // --- EPISODES ---
    async function loadEpisodes(seriesId) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const cleanDns = localStorage.getItem('iptv_dns').replace(/^https?:\/\//, '');
        const grid = document.getElementById('channel-grid');
        grid.innerHTML = '<p style="padding:20px">Loading Episodes...</p>';
        
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${seriesId}`;
        try {
            const res = await fetch(url); // Fetch handles complex nested JSON better
            const data = await res.json();
            currentEpisodes = [];
            if(data.episodes) {
                Object.keys(data.episodes).forEach(seasonNum => {
                    data.episodes[seasonNum].forEach(ep => {
                        ep.season_number = seasonNum; 
                        currentEpisodes.push(ep);
                    });
                });
            }
            inEpisodeView = true;
            currentPage = 0; 
            renderEpisodeGrid();
            currentZone = 'grid'; focusIndex = 0; updateFocus();
        } catch (e) {
            inEpisodeView = false;
            renderSeriesGrid(); 
        }
    }

    function renderEpisodeGrid() {
        const grid = document.getElementById('channel-grid');
        grid.innerHTML = '';
        const start = currentPage * itemsPerPage;
        const pagedList = currentEpisodes.slice(start, start + itemsPerPage);

        document.getElementById('cat-title').textContent = "Episodes";
        grid.innerHTML += `<div class="channel-card nav-item" tabindex="-1" data-type="back" style="background:rgba(255,50,50,0.15);"><div style="height:140px; display:flex; align-items:center; justify-content:center; font-size:2rem;">↩</div></div>`;

        pagedList.forEach((ep, idx) => {
            const img = ep.info?.movie_image || 'images/login-logo.png';
            const title = `S${ep.season_number} E${ep.episode_num} - ${ep.title}`;
            const ext = ep.container_extension || 'mp4';
            grid.innerHTML += `<div class="channel-card nav-item" tabindex="-1" data-id="${ep.id}" data-ext="${ext}"><img src="${img}" onerror="this.src='images/login-logo.png'"><div class="ch-name">${title}</div></div>`;
        });
        
        cardItems = Array.from(document.querySelectorAll('.channel-card'));
        cardItems.forEach((card, idx) => {
            card.addEventListener('click', () => {
                if(card.getAttribute('data-type') === 'back') handleBack();
                // Pass exact index in the whole list
                else playEpisode(card.getAttribute('data-id'), card.getAttribute('data-ext'), card.querySelector('.ch-name').textContent, (currentPage * itemsPerPage) + (idx - 1));
            });
        });
        if (document.activeElement) document.activeElement.blur();
        updateFocus();
    }

    // ==========================================================
    // 🟢 CUSTOM SERIES PLAYER LOGIC (Same as Movies)
    // ==========================================================
    
    let currentPlayIndex = 0;

    async function playEpisode(id, ext, name, indexInList) {
        currentPlayIndex = indexInList;
        const u = localStorage.getItem('iptv_username');
        const p = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';

        let extension = ext ? ext.replace(/^\./, '') : 'mp4';
        const streamUrl = `http://${cleanDns}/series/${u}/${p}/${id}.${extension}`;
        
        console.log("Playing Episode with VLC:", streamUrl);

        try {
            if (!window.Capacitor || !window.Capacitor.Plugins) {
                alert("CRITICAL: Capacitor not loaded!");
                return;
            }

            const nativePlugin = Capacitor.Plugins.Iptvplayer;

            if (nativePlugin) {
                await nativePlugin.play({ url: streamUrl });
                
                // When returning from VLC, ensure focus works
                currentZone = 'grid';
                setTimeout(updateFocus, 500);
            } else {
                alert("VLC Player Plugin (Iptvplayer) missing.");
            }
        } catch (e) {
            alert("Play Error: " + JSON.stringify(e));
        }
    }

    // handleBack function follows below...

    function handleBack() {
        if(document.getElementById('search-container').style.display === 'block') toggleSearch();
        else if(inEpisodeView) {
            inEpisodeView = false; currentZone = 'grid'; currentPage=0; renderSeriesGrid();
        } else {
            window.location.href = 'screen.html';
        }
    }
    
    function toggleSearch() {
        const con = document.getElementById('search-container');
        if(con.style.display==='block') { con.style.display='none'; if(currentCategoryId) loadSeriesByCategory(currentCategoryId); }
        else { con.style.display='block'; document.getElementById('search-input').focus(); currentZone='topbar'; }
    }

    function changePage(d) {
        currentPage += d; if(currentPage<0) currentPage=0;
        if(inEpisodeView) renderEpisodeGrid(); else renderSeriesGrid();
    }
    
    // Resume Listener (Backup for focus)
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('backButton', () => handleBack());
    }

    // --- NAVIGATION HELPERS (GRID/FOCUS) ---
    function getGridColumns() {
        const items = document.querySelectorAll('#channel-grid .channel-card');
        if (items.length < 2) return 1;
        const top = items[0].getBoundingClientRect().top;
        for(let i=1; i<items.length; i++) { if(items[i].getBoundingClientRect().top > top+10) return i; }
        return items.length;
    }
    function updateFocus() {
        document.querySelectorAll('.focused').forEach(el=>el.classList.remove('focused'));
        if(currentZone==='grid') document.querySelectorAll('.sidebar .focused').forEach(el=>el.classList.remove('focused'));
        let target;
        let sel; 
        if(currentZone==='sidebar') sel = '#category-list .category-item';
        else if(currentZone==='grid') sel = '#channel-grid .channel-card';
        else if(currentZone==='topbar') sel = '.top-actions .nav-item';
        else sel = '.pagination-controls .nav-item';
        const items = document.querySelectorAll(sel);
        if(items.length) {
            if(focusIndex >= items.length) focusIndex = items.length-1;
            target = items[focusIndex];
        }
        if(target) { target.classList.add('focused'); target.scrollIntoView({behavior:'smooth', block:'nearest', inline:'nearest'}); }
    }

    document.addEventListener('keydown', (e) => {
        const code = e.keyCode; const cols = getGridColumns();
        if([37,38,39,40].includes(code)) e.preventDefault();

        if (currentZone === 'sidebar') {
            if (code === 38) focusIndex--; else if (code === 40) focusIndex++; else if (code === 39) { currentZone='grid'; focusIndex=0; } else if (code === 13) document.querySelectorAll('#category-list .category-item')[focusIndex]?.click();
        } else if (currentZone === 'grid') {
             if (code === 39) focusIndex++; else if (code === 37) { if(focusIndex%cols===0) { if(inEpisodeView) handleBack(); else { currentZone='sidebar'; focusIndex=0; } } else focusIndex--; }
             else if (code === 38) { if(focusIndex<cols) { currentZone='topbar'; focusIndex=0; } else focusIndex-=cols; } else if (code === 40) { if(focusIndex+cols>=document.querySelectorAll('#channel-grid .channel-card').length) { currentZone='pagination'; focusIndex=2; } else focusIndex+=cols; }
             else if (code === 13) document.querySelectorAll('#channel-grid .channel-card')[focusIndex]?.click();
        } else if (currentZone === 'topbar') {
             if (code === 39) focusIndex++; else if (code === 37) focusIndex--; else if (code === 40) { currentZone='grid'; focusIndex=0; } else if (code === 13) document.querySelectorAll('.top-actions .nav-item')[focusIndex]?.click();
        } else if (currentZone === 'pagination') {
             if (code === 39) focusIndex+=2; else if (code === 37) focusIndex-=2; else if (code === 38) { currentZone='grid'; focusIndex=0; } else if (code === 13) document.querySelectorAll('.pagination-controls .nav-item')[focusIndex]?.click();
        }
        if ([10009, 27, 8].includes(code)) handleBack();
        updateFocus();
    });

    loadCategories();
});