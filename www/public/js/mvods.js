document.addEventListener('DOMContentLoaded', function () {
    console.log("Movies Page Loaded");

    // --- VARIABLES ---
    const lastMovieId = localStorage.getItem('iptv_last_movie_id');
    let shouldRestoreGridFocus = !!lastMovieId;

    let categories = [];
    let currentCategoryId = localStorage.getItem('iptv_last_movie_cat') || null;
    let currentPage = 0;
    const itemsPerPage = 20;

    let focusIndex = 0;
    let currentZone = 'sidebar';

    let categoryItems = [];
    let channelCards = [];
    let currentDisplayList = [];
    let globalMovieIndex = null;

    const root = document.getElementById('vod-vault-root');

    // --- DB SETUP ---
    const DB_NAME = 'VaultCinemaDB_V1';
    const STORE_CATS = 'vault_folders';
    const STORE_MOVIES_CAT = 'vault_movies_by_folder';
    const STORE_MASTER = 'global_movie_index';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_CATS)) db.createObjectStore(STORE_CATS);
                if (!db.objectStoreNames.contains(STORE_MOVIES_CAT)) db.createObjectStore(STORE_MOVIES_CAT);
                if (!db.objectStoreNames.contains(STORE_MASTER)) db.createObjectStore(STORE_MASTER);
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => { resolve(null); };
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

    // --- DOM ---
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
                 <h1 id="folder-title">Movies</h1>
             </div>
          </header>

          <div id="finder-box" style="display:none;">
             <input type="text" id="inp-search" placeholder="Search ALL Movies..." class="pill-search nav-item">
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

    // --- EVENT LISTENERS ---
    document.getElementById('cmd-return').onclick = () => window.location.href = 'screen.html';

    document.getElementById('cmd-refresh').onclick = () => {
        if (document.getElementById('inp-search').value.length > 0) {
            downloadGlobalIndex(true);
        } else if (currentCategoryId) {
            loadMoviesByCategory(currentCategoryId, true);
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
            if (currentCategoryId) loadMoviesByCategory(currentCategoryId);
            return;
        }
        searchTimeout = setTimeout(() => performGlobalSearch(query), 500);
    });

    // --- API Logic ---
    async function loadCategories(forceRefresh = false) {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';
        const urlCats = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_vod_categories`;

        let data = null;
        if (!forceRefresh) data = await getFromCache(STORE_CATS, 'all_vod_categories');

        if (!data) {
            try {
                if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                    const res = await Capacitor.Plugins.CapacitorHttp.get({ url: urlCats });
                    if (res.status === 200) data = res.data;
                } else {
                    const response = await fetch(urlCats);
                    data = await response.json();
                }

                if (data) await saveToCache(STORE_CATS, 'all_vod_categories', data);
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
        let html = '';
        data.forEach(c => {
            html += `<li class="folder-node nav-item" data-id="${c.category_id}" tabindex="-1">${c.category_name}</li>`;
        });
        catEl.innerHTML = html;

        categoryItems = Array.from(document.querySelectorAll('.folder-node'));
        categoryItems.forEach((item, idx) => {
            item.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'sidebar';
                shouldRestoreGridFocus = false;
                document.getElementById('inp-search').value = "";
                selectCategory(item, false);
            });
        });
        setTimeout(updateFocus, 200);
    }

    function selectCategory(item, isAutoLoad = false) {
        if (!item) return;
        const id = item.getAttribute('data-id');
        currentCategoryId = id;
        localStorage.setItem('iptv_last_movie_cat', id);

        const titleEl = document.getElementById('folder-title');
        if (titleEl) titleEl.textContent = item.textContent;

        categoryItems.forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        categoryItems.forEach(el => el.classList.remove('focused'));

        if (!isAutoLoad) {
            currentZone = 'sidebar';
            updateFocus();
        }

        loadMoviesByCategory(id);
    }

    async function loadMoviesByCategory(catId, forceRefresh = false) {
        currentPage = 0;
        const grid = document.getElementById('vod-grid');
        if (grid) grid.innerHTML = '<p style="padding:20px;">Loading...</p>';

        if (!forceRefresh) {
            const cached = await getFromCache(STORE_MOVIES_CAT, `cat_${catId}`);
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
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_vod_streams&category_id=${catId}`;

        try {
            let data = [];
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const res = await Capacitor.Plugins.CapacitorHttp.get({ url: url });
                if (res.status === 200) data = res.data;
            } else {
                const response = await fetch(url);
                data = await response.json();
            }
            await saveToCache(STORE_MOVIES_CAT, `cat_${catId}`, data);
            currentDisplayList = data;
            renderGrid();
        } catch (err) {
            if (grid) grid.innerHTML = `<p style="padding:20px;color:red;">Error: ${err.message}</p>`;
        }
    }

    async function performGlobalSearch(query) {
        shouldRestoreGridFocus = false;
        const titleEl = document.getElementById('folder-title');
        if (titleEl) titleEl.textContent = `Search: "${query}"`;

        if (globalMovieIndex && globalMovieIndex.length > 0) {
            filterAndRenderGlobal(query);
            return;
        }
        const cachedIndex = await getFromCache(STORE_MASTER, 'full_list');
        if (cachedIndex) {
            globalMovieIndex = cachedIndex;
            filterAndRenderGlobal(query);
            return;
        }
        await downloadGlobalIndex();
        if (globalMovieIndex) filterAndRenderGlobal(query);
    }

    async function downloadGlobalIndex() {
        const username = localStorage.getItem('iptv_username');
        const password = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';
        const url = `http://${cleanDns}/player_api.php?username=${username}&password=${password}&action=get_vod_streams`;

        try {
            let data = [];
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const res = await Capacitor.Plugins.CapacitorHttp.get({ url: url });
                if (res.status === 200) data = res.data;
            } else {
                const response = await fetch(url);
                data = await response.json();
            }
            globalMovieIndex = data;
            await saveToCache(STORE_MASTER, 'full_list', data);
        } catch (err) { console.error("Index Error", err); }
    }

    function filterAndRenderGlobal(query) {
        const lowerQ = query.toLowerCase();
        currentDisplayList = globalMovieIndex.filter(m => m.name && m.name.toLowerCase().includes(lowerQ));
        currentPage = 0;
        renderGrid();
    }

    function renderGrid() {
        const grid = document.getElementById('vod-grid');
        if (!grid) return;
        grid.innerHTML = '';

        let list = currentDisplayList;
        if (!list || list.length === 0) {
            grid.innerHTML = '<p style="padding:20px">No movies found.</p>';
            return;
        }

        const start = currentPage * itemsPerPage;
        const pagedList = list.slice(start, start + itemsPerPage);

        pagedList.forEach(ch => {
            const img = ch.stream_icon || 'images/login-logo.png';
            const ext = ch.container_extension || 'mp4';

            grid.innerHTML += `
                <div class="movie-node nav-item" tabindex="-1" data-id="${ch.stream_id}" data-ext="${ext}" oncontextmenu="return false;">
                    <img src="${img}" onerror="this.src='images/login-logo.png'">
                    <div class="movie-title">${ch.name}</div>
                </div>
            `;
        });

        const infoEl = document.getElementById('page-label');
        if (infoEl) {
            const totalPages = Math.ceil(list.length / itemsPerPage);
            infoEl.textContent = `Page ${currentPage + 1} / ${Math.max(1, totalPages)}`;
        }

        channelCards = Array.from(document.querySelectorAll('.movie-node'));
        channelCards.forEach((card, idx) => {
            card.addEventListener('click', () => {
                focusIndex = idx;
                currentZone = 'grid';
                playMovie(card.getAttribute('data-id'), card.getAttribute('data-ext'), card.querySelector('.movie-title').textContent);
            });
        });

        if (shouldRestoreGridFocus) {
            const lastMovieId = localStorage.getItem('iptv_last_movie_id');
            if (lastMovieId) {
                const targetIdx = channelCards.findIndex(card => card.getAttribute('data-id') === lastMovieId);
                if (targetIdx !== -1) {
                    focusIndex = targetIdx;
                    currentZone = 'grid';
                    if (document.activeElement) document.activeElement.blur();
                    setTimeout(updateFocus, 150);
                } else {
                    currentZone = 'sidebar';
                    updateFocus();
                }
            }
            shouldRestoreGridFocus = false;
        } else {
            if (currentZone === 'grid') updateFocus();
        }
    }

    // ==========================================================
    // 🟢 NATIVE PLAYER LOGIC
    // ==========================================================
    async function playMovie(streamId, ext, name) {
        localStorage.setItem('iptv_last_movie_id', streamId);

        const u = localStorage.getItem('iptv_username');
        const p = localStorage.getItem('iptv_password');
        const dns = localStorage.getItem('iptv_dns');
        const cleanDns = dns ? dns.replace(/^https?:\/\//, '') : '';

        let extension = ext ? ext.replace(/^\./, '') : 'mkv';
        const streamUrl = `http://${cleanDns}/movie/${u}/${p}/${streamId}.${extension}`;

        console.log(`Preparing to play: ${streamUrl}`);

        try {
            if (!window.Capacitor || !window.Capacitor.Plugins) {
                alert("CRITICAL: Capacitor not loaded!");
                return;
            }

            const nativePlugin = Capacitor.Plugins.Iptvplayer;

            if (nativePlugin) {
                console.log("Found Native Iptvplayer!");
                await nativePlugin.play({ url: streamUrl });

                currentZone = 'grid';
                setTimeout(updateFocus, 500);
            } else {
                console.warn("Iptvplayer NOT found in Capacitor.Plugins");
                const available = Object.keys(Capacitor.Plugins).join(", ");
                alert("Native Player (Iptvplayer) missing. Available: " + available);
                fallbackPlayer(streamUrl);
            }
        } catch (e) {
            alert("Play Error: " + JSON.stringify(e));
        }
    }

    // Backup Player
    async function fallbackPlayer(url) {
        const Player = Capacitor.Plugins.CapacitorVideoPlayer || Capacitor.Plugins.VideoPlayer;
        if (Player) {
            await Player.initPlayer({
                mode: 'fullscreen',
                url: url,
                playerId: 'fullscreen',
                componentTag: 'div'
            });
        }
    }

    // --- SHARED FUNCTIONS ---
    function toggleSearch() {
        const container = document.getElementById('finder-box');
        const input = document.getElementById('inp-search');
        if (!container || !input) return;

        if (container.style.display === 'block') {
            container.style.display = 'none';
            input.value = '';
            if (currentCategoryId) loadMoviesByCategory(currentCategoryId);
        } else {
            container.style.display = 'block';
            input.focus();
            currentZone = 'topbar';
        }
    }

    function changePage(d) {
        currentPage += d;
        if (currentPage < 0) currentPage = 0;
        renderGrid();
    }

    // --- NAVIGATION LOGIC ---
    function getGridColumns() {
        const items = document.querySelectorAll('#vod-grid .movie-node');
        if (items.length < 2) return 1;
        const firstTop = items[0].getBoundingClientRect().top;
        for (let i = 1; i < items.length; i++) {
            if (items[i].getBoundingClientRect().top > firstTop + 10) return i;
        }
        return items.length;
    }

    function updateFocus() {
        document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        if (currentZone === 'grid') document.querySelectorAll('.library-drawer .focused').forEach(el => el.classList.remove('focused'));

        let target = null;
        let selector = '';

        if (currentZone === 'sidebar') selector = '#folder-list .folder-node';
        else if (currentZone === 'grid') selector = '#vod-grid .movie-node';
        else if (currentZone === 'topbar') selector = '.action-cluster .nav-item';
        else if (currentZone === 'pagination') selector = '.page-stepper .nav-item';

        if (selector) {
            const items = document.querySelectorAll(selector);
            if (items.length > 0) {
                if (focusIndex >= items.length) focusIndex = items.length - 1;
                if (focusIndex < 0) focusIndex = 0;
                target = items[focusIndex];
            }
        }

        if (target) {
            target.classList.add('focused');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }

    document.addEventListener('keydown', function (e) {
        const code = e.keyCode;
        const gridCols = getGridColumns();

        if ([37, 38, 39, 40].includes(code)) e.preventDefault();

        if (currentZone === 'sidebar') {
            if (code === 38) focusIndex--;
            else if (code === 40) focusIndex++;
            else if (code === 39) { currentZone = 'grid'; focusIndex = 0; }
            else if (code === 13) {
                const items = document.querySelectorAll('#folder-list .folder-node');
                if (items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'grid') {
            if (code === 39) focusIndex++;
            else if (code === 37) {
                if (focusIndex % gridCols === 0) {
                    currentZone = 'sidebar';
                    const cats = Array.from(document.querySelectorAll('.folder-node'));
                    let targetIndex = cats.findIndex(c => c.getAttribute('data-id') === currentCategoryId);
                    focusIndex = targetIndex > -1 ? targetIndex : 0;
                } else focusIndex--;
            } else if (code === 38) {
                if (focusIndex < gridCols) { currentZone = 'topbar'; focusIndex = 0; }
                else focusIndex -= gridCols;
            } else if (code === 40) {
                const items = document.querySelectorAll('#vod-grid .movie-node');
                if (focusIndex + gridCols >= items.length) { currentZone = 'pagination'; focusIndex = 2; }
                else focusIndex += gridCols;
            } else if (code === 13) {
                const items = document.querySelectorAll('#vod-grid .movie-node');
                if (items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'topbar') {
            if (code === 39) focusIndex++;
            else if (code === 37) focusIndex--;
            else if (code === 40) { currentZone = 'grid'; focusIndex = 0; }
            else if (code === 13) {
                const items = document.querySelectorAll('.action-cluster .nav-item');
                if (items[focusIndex]) items[focusIndex].click();
            }
        }
        else if (currentZone === 'pagination') {
            if (code === 39) focusIndex += 2;
            else if (code === 37) focusIndex -= 2;
            else if (code === 38) {
                currentZone = 'grid';
                const items = document.querySelectorAll('#vod-grid .movie-node');
                focusIndex = items.length - 1;
            }
            else if (code === 13) {
                const items = document.querySelectorAll('.page-stepper .nav-item');
                if (items[focusIndex]) items[focusIndex].click();
            }
        }

        if (code === 10009 || code === 27 || code === 8) window.location.href = 'screen.html';

        updateFocus();
    });

    loadCategories();
});