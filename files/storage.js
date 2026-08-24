/* =========================================================
   storage.js
   Thin wrapper around localStorage.
   - "Remember me" is opt-in only: without it, the session
     lives in memory (sessionStorage) and disappears when the
     tab/browser closes.
   - Credentials are never stored in plain readable form in
     the DOM; storage keeps only what's needed to reconnect.
   - Cache entries carry a timestamp + TTL so the app avoids
     repeat API calls without ever going fully stale.
========================================================= */
const Storage = (() => {
  const NS = "dashplayer:";
  const KEY_SESSION   = NS + "session";
  const KEY_FAVORITES = NS + "favorites";
  const KEY_HISTORY   = NS + "history";
  const KEY_CACHE     = NS + "cache:";

  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min: long enough to skip refetching per tab switch

  function backendFor(remember) {
    return remember ? localStorage : sessionStorage;
  }

  // ---- session (server/user/pass) ----
  function saveSession(session, remember) {
    const payload = JSON.stringify(session);
    // obfuscate (not encryption — just avoids plain-text at rest in devtools glance)
    const encoded = btoa(unescape(encodeURIComponent(payload)));
    backendFor(remember).setItem(KEY_SESSION, encoded);
    // make sure it's not left in the other storage
    backendFor(!remember).removeItem(KEY_SESSION);
  }

  function loadSession() {
    const raw = localStorage.getItem(KEY_SESSION) || sessionStorage.getItem(KEY_SESSION);
    if (!raw) return null;
    try {
      return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(KEY_SESSION);
    sessionStorage.removeItem(KEY_SESSION);
  }

  // ---- favorites ----
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(KEY_FAVORITES)) || []; }
    catch (e) { return []; }
  }
  function isFavorite(type, id) {
    return getFavorites().some(f => f.type === type && f.id === id);
  }
  function toggleFavorite(item) {
    const favs = getFavorites();
    const idx = favs.findIndex(f => f.type === item.type && f.id === item.id);
    if (idx >= 0) { favs.splice(idx, 1); }
    else { favs.unshift(item); }
    localStorage.setItem(KEY_FAVORITES, JSON.stringify(favs.slice(0, 200)));
    return idx < 0; // true if now favorited
  }

  // ---- history (recently watched) ----
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(KEY_HISTORY)) || []; }
    catch (e) { return []; }
  }
  function pushHistory(item) {
    const hist = getHistory().filter(h => !(h.type === item.type && h.id === item.id));
    hist.unshift({ ...item, watchedAt: Date.now() });
    localStorage.setItem(KEY_HISTORY, JSON.stringify(hist.slice(0, 40)));
  }

  // ---- generic cache for API responses ----
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(KEY_CACHE + key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > CACHE_TTL_MS) return null;
      return v;
    } catch (e) { return null; }
  }
  function cacheSet(key, value) {
    try {
      localStorage.setItem(KEY_CACHE + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (e) {
      // storage full or unavailable — fail silently, app still works uncached
    }
  }
  function cacheClearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(KEY_CACHE))
      .forEach(k => localStorage.removeItem(k));
  }

  function wipeAll() {
    clearSession();
    cacheClearAll();
    // favorites/history are user data the person may want to keep across
    // logins on the same device; logout only clears the session + cache.
  }

  return {
    saveSession, loadSession, clearSession,
    getFavorites, isFavorite, toggleFavorite,
    getHistory, pushHistory,
    cacheGet, cacheSet, cacheClearAll,
    wipeAll,
  };
})();
