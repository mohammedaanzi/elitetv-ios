document.addEventListener('DOMContentLoaded', function () {
    console.log("Series Page Loaded");

    // --- VARIABLES ---
    let categories = [];
    let currentCategoryId = null;
    let currentPage = 0;
    const itemsPerPage = 20;

    // TV Variables
    let focusIndex = 0;
    let currentZone = 'sidebar';

    let inEpisodeView = false;
    let categoryItems = [];
    let cardItems = [];
    let currentSeriesList = [];
    let currentEpisodes = [];
    let globalSeriesIndex = null;

    // ===== FAVORITES =====
    const FAV_KEY = 'p4a_fav_series';

    function getFavorites() {
        try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
        catch(e) { return []; }
    }

    function saveFavorites(favs) {
        localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    }

    function isFavorite(seriesId) {
        return getFavorites().includes(String(seriesId));
    }

    function toggleFavorite(seriesId) {
        const id = String(seriesId);
        let favs = getFavorites();
        if (favs.includes(id)) {
            favs = favs.filter(f => f !== id);
        } else {
            favs.push(id);
        }
        saveFavorites(favs);
        updateFavCount();
    }

    function updateFavCount() {
        const badge = document.getElementById('fav-count-badge');
        if (badge) badge.textContent = getFavorites().length;
    }

    const root = document.getElementById('series-vault-root');

    // --- DB SETUP ---
    const DB_NAME = 'VaultSeriesDB_V1';
    const STORE_CATS = 'series_folders';
    const STORE_SERIES_CAT = 'series_by_folder';
    const STORE_MASTER = 'global_series_index';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 11);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_CATS)) db.createObjectStore(STORE_CATS);
                if (!db.objectStoreNames.contains(STORE_SERIES_CAT)) db.createObjectStore(STORE_SERIES_CAT);
                if (!db.objectStoreNames.contains(STORE_MASTER)) db.createObjectStore(STORE_MASTER);
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => resolve(null);
        });
    }

    async function saveToCache(store, key, data) {
        try {
            const db = await openDB();
            if (!db) return;
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(data, key);
        } catch (e) { }
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

    async function clearAllCache() {
        try {
            const db = await openDB();
            if (!db) return;
            const stores = [STORE_CATS, STORE_SERIES_CAT, STORE_MASTER];
            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(s => tx.objectStore(s).clear());
            globalSeriesIndex = null;
        } catch(e) {}
    }

    // --- DOM STRUCTURE ---
    root.innerHTML = `
      <div class="vault-layout">
        <aside class="library-drawer">
          <h2>Categories</h2>
          <ul id="folder-list"><li style="padding:20px; color:#aaa;">Loading...</li></ul>
        </aside>

        <main class="gallery-stage">
          <header class="gallery-top-bar">
             <div class="action-cluster">
                <button id="cmd-return" class="pill-btn nav-item" type="button">← Home</button>
                <button id="cmd-refresh" class="pill-btn nav-item" type="button">Refresh</button>
                <button id="cmd-search" class="pill-btn nav-item" type="button">Search</button>
             </div>
             <div class="meta-cluster">
                 <h1 id="folder-title">Series</h1>
             </div>
          </header>

          <div id="finder-box" style="display:none;">
             <input type="text" id="inp-search" placeholder="Search ALL Series..." class="pill-search nav-item">
          </div>

          <div id="vod-grid" class="vod-grid">
             <p style="padding:20px; font-size:1.2rem;">Loading...</p>
          </div>

          <footer class="page-stepper">
             <button id="cmd-prev" class="pill-btn nav-item" type="button">Prev</button>
             <span id="page-label" style="margin: 0 20px; font-size: 1.1rem;">Page 1</span>
             <button id="cmd-next" class="pill-btn nav-item" type="button">Next</button>
          </footer>
        </main>
      </div>
    `;

    document.getElementById('cmd-return').onclick = () => handleBack();
    document.getElementById('cmd-refresh').onclick = async () => {
        await clearAllCache();
        currentCategoryId = null;
        const searchInput = document.getElementById('inp-search');
        if (searchInput && searchInput.value.length > 0) {
            await downloadGlobalIndex(true);
            filterAndRenderGlobal(searchInput.value.trim());
        } else {
            loadCategories(true);
        }
    };
    document.getElementById('cmd-search').onclick = toggleSearch;
    document.getElementById('cmd-prev').onclick = () => changePage(-1);
    document.getElementById('cmd-next').onclick = () => changePage(1);

    let searchTimeout = null;
    const searchInput = document.getElementById('inp-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchTimeout);
            if (query.length === 0) {
                if (currentCategoryId) loadSeriesByCategory(currentCategoryId);
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
                    const res = await AppHttp.get({ url: urlCats });
                    if (res.status === 200) data = res.data;
                } else {
                    const res = await fetch(urlCats);
                    data = await res.json();
                }
                await saveToCache(STORE_CATS, 'all_series_categories', data);
            } catch (err) { }
        }
        if (data) {
            renderSidebar(data);
            let targetBtn = null;
            if (currentCategoryId) targetBtn = document.querySelector(`.folder-node[data-id="${currentCategoryId}"]`);
            if (!targetBtn) {
                targetBtn = document.querySelector('.folder-node');
                if (targetBtn) currentCategoryId = targetBtn.getAttribute('data-id');
            }
            if (targetBtn) selectCategory(targetBtn, true);
        }
    }

    function renderSidebar(data) {
        const catEl = document.getElementById('folder-list');
        categories = data;

        // Inject Favorites category at the top
        let html = `<li class="folder-node nav-item fav-cat-item" data-id="favorites" tabindex="-1">
            <span class="fav-star-sidebar">★</span> Favorites 
            <span class="fav-count" id="fav-count-badge">${getFavorites().length}</span>
        </li>
        <li class="folder-node nav-item fav-cat-item" data-id="recently_added" tabindex="-1" style="border-bottom-color: rgba(96, 165, 250, 0.1);">
            <span style="color: #60a5fa; font-size: 1.1rem; text-shadow: 0 0 8px rgba(96, 165, 250, 0.4); margin-right: 4px;">🕒</span> Recently Added
        </li>`;
        data.forEach(c => html += `<li class="folder-node nav-item" data-id="${c.category_id}" tabindex="-1">${c.category_name}</li>`);
        catEl.innerHTML = html;
        categoryItems = Array.from(document.querySelectorAll('.folder-node'));
        categoryItems.forEach((item, idx) => {
            item.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'sidebar';
                document.getElementById('inp-search').value = "";
                selectCategory(item);
            });
        });
        setTimeout(updateFocus, 200);
    }

    function selectCategory(item, isAutoLoad = false) {
        if (!item) return;
        const id = item.getAttribute('data-id');
        currentCategoryId = id;
        
        if (id === 'favorites') {
            document.getElementById('folder-title').textContent = '★ Favorites';
        } else if (id === 'recently_added') {
            document.getElementById('folder-title').textContent = '🕒 Recently Added';
        } else {
            document.getElementById('folder-title').textContent = item.textContent;
        }

        categoryItems.forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        if (!isAutoLoad) { currentZone = 'sidebar'; updateFocus(); }

        if (id === 'favorites') {
            loadFavoriteSeries();
        } else if (id === 'recently_added') {
            loadRecentlyAddedSeries();
        } else {
            loadSeriesByCategory(id);
        }
    }

    async function loadFavoriteSeries() {
        inEpisodeView = false;
        currentPage = 0;
        const favIds = getFavorites();
        const grid = document.getElementById('vod-grid');

        if (favIds.length === 0) {
            currentSeriesList = [];
            if (grid) grid.innerHTML = `
                <div style="grid-column: 1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; color:#475569; text-align:center;">
                    <div style="font-size:3rem; margin-bottom:12px; opacity:0.3;">★</div>
                    <div style="font-size:1rem; font-weight:600; color:#94a3b8; margin-bottom:6px;">No Favorite Series Yet</div>
                    <div style="font-size:0.85rem; line-height:1.5;">Tap the ★ on any series to save it here</div>
                </div>`;
            return;
        }

        if (grid) grid.innerHTML = '<p style="padding:20px;">Loading favorites...</p>';

        let allSeries = [];
        const db = await openDB();
        if (db) {
            const tx = db.transaction(STORE_SERIES_CAT, 'readonly');
            const store = tx.objectStore(STORE_SERIES_CAT);
            const allKeys = await new Promise(resolve => {
                const req = store.getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve([]);
            });
            for (const key of allKeys) {
                const data = await getFromCache(STORE_SERIES_CAT, key);
                if (data && Array.isArray(data)) allSeries = allSeries.concat(data);
            }
        }

        currentSeriesList = allSeries.filter(s => favIds.includes(String(s.series_id)));
        renderSeriesGrid();
    }

    async function loadRecentlyAddedSeries() {
        inEpisodeView = false;
        currentPage = 0;
        const grid = document.getElementById('vod-grid');
        if (grid) grid.innerHTML = '<p style="padding:20px;">Loading latest series...</p>';

        let allSeries = [];
        if (globalSeriesIndex && globalSeriesIndex.length > 0) {
            allSeries = globalSeriesIndex;
        } else {
            const cached = await getFromCache(STORE_MASTER, 'full_list');
            if (cached) {
                globalSeriesIndex = cached;
                allSeries = cached;
            } else {
                await downloadGlobalIndex();
                allSeries = globalSeriesIndex || [];
            }
        }

        if (!allSeries || allSeries.length === 0) {
            if (grid) grid.innerHTML = '<p style="padding:20px;">No series found to sort.</p>';
            return;
        }

        // Fast extraction of top 150 items without heavy client-side sorting.
        // Xtream APIs naturally append new items to the end of the array.
        // Sorting 10,000+ items with JS Math freezes devices.
        const topItems = [];
        const len = allSeries.length;
        for (let i = len - 1; i >= Math.max(0, len - 150); i--) {
            if (allSeries[i]) topItems.push(allSeries[i]);
        }

        currentSeriesList = topItems;
        renderSeriesGrid();
    }

    async function loadSeriesByCategory(catId, forceRefresh = false) {
        inEpisodeView = false;
        currentPage = 0;
        document.getElementById('vod-grid').innerHTML = '<p style="padding:20px;">Loading...</p>';

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
                const res = await AppHttp.get({ url: url });
                data = res.data;
            } else {
                const res = await fetch(url);
                data = await res.json();
            }
            await saveToCache(STORE_SERIES_CAT, `cat_${catId}`, data);
            currentSeriesList = data;
            renderSeriesGrid();
        } catch (err) {
            document.getElementById('vod-grid').innerHTML = `<p style="padding:20px;color:red;">Error: ${err.message}</p>`;
        }
    }

    async function performGlobalSearch(query) {
        document.getElementById('folder-title').textContent = `Search: "${query}"`;
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
            const res = await AppHttp.get({ url: url });
            if (res.status === 200) {
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
        const grid = document.getElementById('vod-grid');
        grid.innerHTML = '';
        if (currentSeriesList.length === 0) { grid.innerHTML = '<p style="padding:20px">No series found.</p>'; return; }
        const start = currentPage * itemsPerPage;
        const pagedList = currentSeriesList.slice(start, start + itemsPerPage);

        pagedList.forEach(s => {
            const img = s.cover || s.stream_icon || 'images/login-logo.png';
            const favClass = isFavorite(s.series_id) ? 'is-fav' : '';
            grid.innerHTML += `
                <div class="movie-node nav-item" tabindex="-1" data-id="${s.series_id}">
                    <button class="fav-star-btn ${favClass}" data-series-id="${s.series_id}" type="button" title="Toggle Favorite">★</button>
                    <img src="${img}" onerror="this.src='images/login-logo.png'">
                    <div class="movie-title">${s.name}</div>
                </div>`;
        });

        document.getElementById('page-label').textContent = `Page ${currentPage + 1} / ${Math.max(1, Math.ceil(currentSeriesList.length / itemsPerPage))}`;

        cardItems = Array.from(document.querySelectorAll('.movie-node'));
        cardItems.forEach((card, idx) => {
            const starBtn = card.querySelector('.fav-star-btn');
            if (starBtn) {
                starBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sid = starBtn.getAttribute('data-series-id');
                    toggleFavorite(sid);
                    starBtn.classList.toggle('is-fav');
                    starBtn.classList.add('fav-pop');
                    setTimeout(() => starBtn.classList.remove('fav-pop'), 300);
                    if (currentCategoryId === 'favorites') {
                        loadFavoriteSeries();
                    }
                });
            }

            card.addEventListener('click', () => { focusIndex = idx; currentZone = 'grid'; loadEpisodes(card.getAttribute('data-id')); });
        });
        if (currentZone === 'grid') updateFocus();
    }

    // --- EPISODES ---
    async function loadEpisodes(seriesId) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const cleanDns = localStorage.getItem('iptv_dns').replace(/^https?:\/\//, '');
        const grid = document.getElementById('vod-grid');
        grid.innerHTML = '<p style="padding:20px">Loading Episodes...</p>';

        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${seriesId}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            currentEpisodes = [];
            if (data.episodes) {
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
        const grid = document.getElementById('vod-grid');
        grid.innerHTML = '';
        const start = currentPage * itemsPerPage;
        const pagedList = currentEpisodes.slice(start, start + itemsPerPage);

        document.getElementById('folder-title').textContent = "Episodes";
        grid.innerHTML += `<div class="movie-node nav-item" tabindex="-1" data-type="back" style="background:rgba(220, 38, 38, 0.2);"><div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 4rem; color: #fff; z-index: 2; text-shadow: 0 4px 12px rgba(0,0,0,0.5);">↩</div></div>`;
        pagedList.forEach((ep, idx) => {
            const img = ep.info?.movie_image || 'images/login-logo.png';
            const title = `S${ep.season_number} E${ep.episode_num} - ${ep.title}`;
            const ext = ep.container_extension || 'mp4';
            grid.innerHTML += `<div class="movie-node nav-item" tabindex="-1" data-id="${ep.id}" data-ext="${ext}"><img src="${img}" onerror="this.src='images/login-logo.png'"><div class="movie-title">${title}</div></div>`;
        });

        cardItems = Array.from(document.querySelectorAll('.movie-node'));
        cardItems.forEach((card, idx) => {
            card.addEventListener('click', () => {
                if (card.getAttribute('data-type') === 'back') handleBack();
                else playEpisode(card.getAttribute('data-id'), card.getAttribute('data-ext'), card.querySelector('.movie-title').textContent, (currentPage * itemsPerPage) + (idx - 1));
            });
        });
        if (document.activeElement) document.activeElement.blur();
        updateFocus();
    }

    // ==========================================================
    // 🟢 SERIES PLAYER LOGIC
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
                await nativePlugin.play({ url: streamUrl, title: name, mode: "vod" });
                currentZone = 'grid';
                setTimeout(updateFocus, 500);
            } else {
                alert("VLC Player Plugin (Iptvplayer) missing.");
            }
        } catch (e) {
            alert("Play Error: " + JSON.stringify(e));
        }
    }

    function handleBack() {
        if (document.getElementById('finder-box').style.display === 'block') toggleSearch();
        else if (inEpisodeView) {
            inEpisodeView = false; currentZone = 'grid'; currentPage = 0; renderSeriesGrid();
        } else {
            window.location.href = 'screen.html';
        }
    }

    function toggleSearch() {
        const con = document.getElementById('finder-box');
        if (con.style.display === 'block') { con.style.display = 'none'; if (currentCategoryId) loadSeriesByCategory(currentCategoryId); }
        else { con.style.display = 'block'; document.getElementById('inp-search').focus(); currentZone = 'topbar'; focusIndex = 3; }
    }

    function changePage(d) {
        currentPage += d; if (currentPage < 0) currentPage = 0;
        if (inEpisodeView) renderEpisodeGrid(); else renderSeriesGrid();
    }

    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('backButton', () => handleBack());
    }

    // --- NAVIGATION HELPERS ---
    function getGridColumns() {
        const items = document.querySelectorAll('#vod-grid .movie-node');
        if (items.length < 2) return 1;
        const top = items[0].getBoundingClientRect().top;
        for (let i = 1; i < items.length; i++) { if (items[i].getBoundingClientRect().top > top + 10) return i; }
        return items.length;
    }
    function updateFocus() {
        document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        if (currentZone === 'grid') document.querySelectorAll('.library-drawer .focused').forEach(el => el.classList.remove('focused'));
        let target;
        let sel;
        if (currentZone === 'sidebar') sel = '#folder-list .folder-node';
        else if (currentZone === 'grid') sel = '#vod-grid .movie-node';
        else if (currentZone === 'topbar') {
            const searchBox = document.getElementById('finder-box');
            if (searchBox && searchBox.style.display === 'block') sel = '.action-cluster .nav-item, #finder-box .nav-item';
            else sel = '.action-cluster .nav-item';
        }
        else sel = '.page-stepper .nav-item';
        const items = document.querySelectorAll(sel);
        if (items.length) {
            if (focusIndex >= items.length) focusIndex = items.length - 1;
            target = items[focusIndex];
        }
        if (target) { target.classList.add('focused'); target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }
    }

    document.addEventListener('keydown', (e) => {
        const code = e.keyCode; const cols = getGridColumns();
        if ([37, 38, 39, 40].includes(code)) e.preventDefault();

        if (currentZone === 'sidebar') {
            if (code === 38) focusIndex--; else if (code === 40) focusIndex++; else if (code === 39) { currentZone = 'grid'; focusIndex = 0; } else if (code === 13) document.querySelectorAll('#folder-list .folder-node')[focusIndex]?.click();
        } else if (currentZone === 'grid') {
            if (code === 39) focusIndex++; else if (code === 37) { if (focusIndex % cols === 0) { if (inEpisodeView) handleBack(); else { currentZone = 'sidebar'; focusIndex = 0; } } else focusIndex--; }
            else if (code === 38) { if (focusIndex < cols) { currentZone = 'topbar'; focusIndex = 0; } else focusIndex -= cols; } else if (code === 40) { if (focusIndex + cols >= document.querySelectorAll('#vod-grid .movie-node').length) { currentZone = 'pagination'; focusIndex = 2; } else focusIndex += cols; }
            else if (code === 13) document.querySelectorAll('#vod-grid .movie-node')[focusIndex]?.click();
        } else if (currentZone === 'topbar') {
            if (code === 39) focusIndex++; 
            else if (code === 37) focusIndex--; 
            else if (code === 40) { 
                const searchBox = document.getElementById('finder-box');
                if (focusIndex < 3 && searchBox && searchBox.style.display === 'block') focusIndex = 3;
                else { currentZone = 'grid'; focusIndex = 0; } 
            }
            else if (code === 38) {
                if (focusIndex === 3) focusIndex = 2;
            }
            else if (code === 13) {
                const searchBox = document.getElementById('finder-box');
                const sel = (searchBox && searchBox.style.display === 'block') ? '.action-cluster .nav-item, #finder-box .nav-item' : '.action-cluster .nav-item';
                const items = document.querySelectorAll(sel);
                if (items[focusIndex]) {
                    if (items[focusIndex].id === 'inp-search') items[focusIndex].focus();
                    else items[focusIndex].click();
                }
            }
        } else if (currentZone === 'pagination') {
            if (code === 39) focusIndex += 2; else if (code === 37) focusIndex -= 2; else if (code === 38) { currentZone = 'grid'; focusIndex = 0; } else if (code === 13) document.querySelectorAll('.page-stepper .nav-item')[focusIndex]?.click();
        }
        if ([10009, 27, 8].includes(code)) handleBack();
        updateFocus();
    });

    loadCategories();
});