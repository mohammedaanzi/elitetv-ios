/* Shared HTTP helper
   - Inside the native app: uses CapacitorHttp (no CORS, http allowed)
   - In a normal browser: falls back to fetch() so the app doesn't crash
   Returns { status, data } like CapacitorHttp. */
(function () {
    function nativeHttp() {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    }

    async function browserGet(options) {
        const timeout = options.readTimeout || options.connectTimeout || 15000;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const res = await fetch(options.url, { method: 'GET', headers: options.headers || {}, signal: ctrl.signal });
            const text = await res.text();
            let data = text;
            try { data = JSON.parse(text); } catch (e) { /* not JSON, keep text */ }
            return { status: res.status, data: data, headers: {} };
        } finally {
            clearTimeout(timer);
        }
    }

    window.AppHttp = {
        isNative: function () { return !!nativeHttp(); },
        get: async function (options) {
            const plugin = nativeHttp();
            if (plugin) {
                const res = await plugin.get(options);
                // Some servers return JSON as plain text — parse it if needed
                if (typeof res.data === 'string') {
                    try { res.data = JSON.parse(res.data); } catch (e) {}
                }
                return res;
            }
            return browserGet(options);
        }
    };
})();
