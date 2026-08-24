/* =========================================================
   api.js
   Minimal Xtream Codes API client.
   Every call goes through `call()`, which adds a timeout,
   normalizes errors, and (for GET list endpoints) transparently
   uses the local cache so switching tabs doesn't refire the
   same request against a possibly slow/unstable connection.
========================================================= */
const XtreamAPI = (() => {
  let base = "";     // e.g. http://example.com:8080
  let user = "";
  let pass = "";

  const TIMEOUT_MS = 12000;

  function configure(session) {
    base = session.server.replace(/\/+$/, "");
    user = session.username;
    pass = session.password;
  }

  function isConfigured() {
    return !!(base && user && pass);
  }

  async function call(action, params = {}, { cache = true } = {}) {
    if (!isConfigured()) throw new ApiError("NOT_CONFIGURED", "Session absente.");

    const cacheKey = action + JSON.stringify(params);
    if (cache) {
      const hit = Storage.cacheGet(cacheKey);
      if (hit) return hit;
    }

    const url = new URL(base + "/player_api.php");
    url.searchParams.set("username", user);
    url.searchParams.set("password", pass);
    if (action) url.searchParams.set("action", action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    try {
      res = await fetch(url.toString(), { signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") throw new ApiError("TIMEOUT", "Le serveur ne répond pas.");
      throw new ApiError("NETWORK", "Connexion au serveur impossible.");
    }
    clearTimeout(timer);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ApiError("AUTH", "Identifiants refusés.");
      }
      throw new ApiError("HTTP", "Erreur serveur (" + res.status + ").");
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new ApiError("PARSE", "Réponse du serveur illisible.");
    }

    if (cache) Storage.cacheSet(cacheKey, data);
    return data;
  }

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // ---- account / auth ----
  async function login(session) {
    configure(session);
    const data = await call("", {}, { cache: false });
    const info = data && data.user_info;
    if (!info || info.auth !== 1) {
      throw new ApiError("AUTH", "Identifiants refusés par le serveur.");
    }
    return info;
  }

  // ---- categories & lists ----
  const getLiveCategories   = () => call("get_live_categories");
  const getLiveStreams      = (categoryId) => call("get_live_streams", categoryId ? { category_id: categoryId } : {});
  const getVodCategories    = () => call("get_vod_categories");
  const getVodStreams       = (categoryId) => call("get_vod_streams", categoryId ? { category_id: categoryId } : {});
  const getSeriesCategories = () => call("get_series_categories");
  const getSeriesList       = (categoryId) => call("get_series", categoryId ? { category_id: categoryId } : {});
  const getSeriesInfo       = (seriesId) => call("get_series_info", { series_id: seriesId });
  const getShortEpg         = (streamId) => call("get_short_epg", { stream_id: streamId, limit: 4 }, { cache: false });

  // ---- stream URL builders ----
  // Xtream servers expose raw MPEG-TS at /live/.../{id}.ts — prefer that
  // over the HLS (.m3u8) variant whenever it's available, per spec.
  function liveStreamUrl(streamId, ext = "ts") {
    return `${base}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${streamId}.${ext}`;
  }
  function vodStreamUrl(streamId, ext) {
    return `${base}/movie/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${streamId}.${ext || "mp4"}`;
  }
  function seriesEpisodeUrl(episodeId, ext) {
    return `${base}/series/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${episodeId}.${ext || "mp4"}`;
  }

  return {
    ApiError, configure, isConfigured, login,
    getLiveCategories, getLiveStreams,
    getVodCategories, getVodStreams,
    getSeriesCategories, getSeriesList, getSeriesInfo, getShortEpg,
    liveStreamUrl, vodStreamUrl, seriesEpisodeUrl,
  };
})();
