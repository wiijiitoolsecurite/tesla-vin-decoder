/* =========================================================
   app.js — main controller
   Wires: login screen, tab/category/grid navigation, series
   episode panel, player screen controls, search, favorites,
   logout. Kept as one file (no bundler) so the whole app stays
   a handful of small, cacheable static files behind Nginx.
========================================================= */
(() => {
  "use strict";

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);

  const screenLogin  = $("screen-login");
  const screenApp    = $("screen-app");
  const screenPlayer = $("screen-player");

  const loginForm   = $("login-form");
  const loginError  = $("login-error");
  const btnConnect  = $("btn-connect");

  const mainTabs      = $("main-tabs");
  const categoryList  = $("category-list");
  const categoryRail  = $("category-rail");
  const gridContent   = $("grid-content");
  const gridEmpty     = $("grid-empty");
  const gridLoading   = $("grid-loading");
  const episodePanel  = $("episode-panel");
  const seasonTabs    = $("season-tabs");
  const episodeList   = $("episode-list");
  const episodePanelTitle = $("episode-panel-title");
  const btnBack       = $("btn-back");
  const btnLogout     = $("btn-logout");

  const btnSearch      = $("btn-search");
  const searchBar       = $("search-bar");
  const searchInput     = $("search-input");
  const btnSearchClose  = $("btn-search-close");

  const toastEl = $("toast");

  // player screen
  const btnPlayerClose = $("btn-player-close");
  const playerTitle    = $("player-title");
  const playerStatus   = $("player-status");
  const btnFavorite    = $("btn-favorite");
  const btnPlayPause   = $("btn-playpause");
  const iconPlay        = $("icon-play");
  const iconPause       = $("icon-pause");
  const seekBar         = $("seek-bar");
  const timeCurrent      = $("time-current");
  const timeDuration     = $("time-duration");
  const volumeBar        = $("volume-bar");
  const btnFullscreen    = $("btn-fullscreen");
  const playerWrap        = document.querySelector(".player-wrap");

  // ---------- state ----------
  let state = {
    tab: "live",
    categories: [],
    activeCategoryId: "all",
    allStreamsCache: {},   // { live: [...], movies: [...], series: [...] } — full unfiltered list per tab
    currentSeries: null,   // { info, episodesBySeason, activeSeason }
    nowPlaying: null,      // { type, id, title, poster }
  };

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, ms = 3200) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  function showScreen(el) {
    [screenLogin, screenApp, screenPlayer].forEach(s => s.hidden = (s !== el));
  }

  // ========================================================
  // LOGIN
  // ========================================================
  async function tryRestoreSession() {
    const session = Storage.loadSession();
    if (!session) { showScreen(screenLogin); return; }
    btnConnect.textContent = "Connexion…";
    try {
      XtreamAPI.configure(session);
      await XtreamAPI.login(session);
      enterApp();
    } catch (e) {
      Storage.clearSession();
      showScreen(screenLogin);
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;

    const session = {
      server: $("input-server").value.trim().replace(/\/+$/, ""),
      username: $("input-username").value.trim(),
      password: $("input-password").value,
    };
    const remember = $("input-remember").checked;

    btnConnect.disabled = true;
    btnConnect.textContent = "Connexion…";
    try {
      await XtreamAPI.login(session);
      Storage.saveSession(session, remember);
      enterApp();
    } catch (err) {
      loginError.textContent = describeError(err);
      loginError.hidden = false;
    } finally {
      btnConnect.disabled = false;
      btnConnect.textContent = "Se connecter";
    }
  });

  function describeError(err) {
    if (err && err.code === "AUTH") return "Serveur, identifiant ou mot de passe incorrect.";
    if (err && err.code === "TIMEOUT") return "Le serveur ne répond pas. Réessayez.";
    if (err && err.code === "NETWORK") return "Connexion impossible. Vérifiez l'adresse du serveur.";
    return "Une erreur est survenue. Réessayez.";
  }

  function enterApp() {
    showScreen(screenApp);
    switchTab("live");
  }

  btnLogout.addEventListener("click", () => {
    Storage.wipeAll();
    state.allStreamsCache = {};
    showScreen(screenLogin);
    loginForm.reset();
    toast("Déconnecté.");
  });

  // ========================================================
  // TABS / CATEGORIES / GRID
  // ========================================================
  mainTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  async function switchTab(tab) {
    state.tab = tab;
    state.activeCategoryId = "all";
    episodePanel.hidden = true;
    categoryRail.hidden = false;
    [...mainTabs.children].forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    closeSearch();

    await Promise.all([loadCategories(tab), loadStreams(tab, "all")]);
  }

  async function loadCategories(tab) {
    categoryList.innerHTML = "";
    try {
      let cats;
      if (tab === "live") cats = await XtreamAPI.getLiveCategories();
      else if (tab === "movies") cats = await XtreamAPI.getVodCategories();
      else cats = await XtreamAPI.getSeriesCategories();

      state.categories = Array.isArray(cats) ? cats : [];
      renderCategories();
    } catch (err) {
      handleApiError(err);
    }
  }

  function renderCategories() {
    categoryList.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.className = "category-item active";
    allBtn.textContent = "Toutes";
    allBtn.dataset.id = "all";
    categoryList.appendChild(allBtn);

    state.categories.forEach(cat => {
      const b = document.createElement("button");
      b.className = "category-item";
      b.textContent = cat.category_name || "Sans nom";
      b.dataset.id = cat.category_id;
      categoryList.appendChild(b);
    });
  }

  categoryList.addEventListener("click", (e) => {
    const btn = e.target.closest(".category-item");
    if (!btn) return;
    [...categoryList.children].forEach(b => b.classList.toggle("active", b === btn));
    state.activeCategoryId = btn.dataset.id;
    loadStreams(state.tab, btn.dataset.id);
  });

  async function loadStreams(tab, categoryId) {
    setGridLoading(true);
    try {
      let items;
      if (categoryId === "all" && state.allStreamsCache[tab]) {
        items = state.allStreamsCache[tab];
      } else if (categoryId === "all") {
        items = await fetchAllStreams(tab);
        state.allStreamsCache[tab] = items;
      } else {
        items = await fetchStreams(tab, categoryId);
      }
      renderGrid(normalizeItems(tab, items));
    } catch (err) {
      handleApiError(err);
      renderGrid([]);
    } finally {
      setGridLoading(false);
    }
  }

  function fetchStreams(tab, categoryId) {
    if (tab === "live") return XtreamAPI.getLiveStreams(categoryId);
    if (tab === "movies") return XtreamAPI.getVodStreams(categoryId);
    return XtreamAPI.getSeriesList(categoryId);
  }
  function fetchAllStreams(tab) {
    if (tab === "live") return XtreamAPI.getLiveStreams();
    if (tab === "movies") return XtreamAPI.getVodStreams();
    return XtreamAPI.getSeriesList();
  }

  function normalizeItems(tab, raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(it => {
      if (tab === "live") return { type: "live", id: it.stream_id, name: it.name, epgId: it.epg_channel_id };
      if (tab === "movies") return { type: "movie", id: it.stream_id, name: it.name, ext: it.container_extension };
      return { type: "series", id: it.series_id, name: it.name };
    });
  }

  function setGridLoading(is) {
    gridLoading.hidden = !is;
    if (is) { gridContent.innerHTML = ""; gridEmpty.hidden = true; }
  }

  function renderGrid(items) {
    gridContent.innerHTML = "";
    gridEmpty.hidden = items.length !== 0;
    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(buildGridCell(item)));
    gridContent.appendChild(frag);
  }

  function buildGridCell(item) {
    const el = document.createElement("button");
    el.className = "grid-item";
    el.innerHTML = `
      <span class="item-name">${escapeHtml(item.name)}</span>
      <span class="item-sub">${item.type === "live" ? "Direct" : item.type === "movie" ? "Film" : "Série"}</span>
    `;
    el.addEventListener("click", () => openItem(item));
    return el;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ========================================================
  // SEARCH
  // ========================================================
  btnSearch.addEventListener("click", () => {
    searchBar.hidden = false;
    searchInput.value = "";
    searchInput.focus();
    ensureFullTabCache().then(() => {});
  });
  btnSearchClose.addEventListener("click", closeSearch);
  function closeSearch() {
    searchBar.hidden = true;
    searchInput.value = "";
  }

  async function ensureFullTabCache() {
    if (!state.allStreamsCache[state.tab]) {
      try { state.allStreamsCache[state.tab] = await fetchAllStreams(state.tab); }
      catch (err) { handleApiError(err); }
    }
  }

  searchInput.addEventListener("input", async () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { loadStreams(state.tab, state.activeCategoryId); return; }
    await ensureFullTabCache();
    const all = normalizeItems(state.tab, state.allStreamsCache[state.tab] || []);
    renderGrid(all.filter(it => it.name.toLowerCase().includes(q)));
  });

  // ========================================================
  // BACK BUTTON (from episode panel / player)
  // ========================================================
  btnBack.addEventListener("click", () => {
    episodePanel.hidden = true;
    btnBack.hidden = true;
  });

  // ========================================================
  // OPEN ITEM (live / movie / series)
  // ========================================================
  async function openItem(item) {
    if (item.type === "series") {
      openSeries(item);
      return;
    }
    Storage.pushHistory(item);
    const urls = item.type === "live"
      ? { ts: XtreamAPI.liveStreamUrl(item.id, "ts"), m3u8: XtreamAPI.liveStreamUrl(item.id, "m3u8") }
      : { ts: undefined, m3u8: undefined, direct: XtreamAPI.vodStreamUrl(item.id, item.ext) };

    openPlayerScreen(item);

    if (item.type === "movie") {
      // VOD is a normal progressive file — no TS/HLS negotiation needed.
      Player.play(item, { ts: urls.direct });
    } else {
      Player.play(item, urls);
    }
  }

  async function openSeries(item) {
    setGridLoading(true);
    try {
      const info = await XtreamAPI.getSeriesInfo(item.id);
      const episodesBySeason = info.episodes || {};
      state.currentSeries = { item, episodesBySeason, activeSeason: Object.keys(episodesBySeason)[0] };
      renderSeriesPanel();
      episodePanel.hidden = false;
      btnBack.hidden = false;
    } catch (err) {
      handleApiError(err);
    } finally {
      setGridLoading(false);
    }
  }

  function renderSeriesPanel() {
    const { item, episodesBySeason, activeSeason } = state.currentSeries;
    episodePanelTitle.textContent = item.name;
    seasonTabs.innerHTML = "";
    Object.keys(episodesBySeason).forEach(season => {
      const b = document.createElement("button");
      b.className = "season-tab" + (season === activeSeason ? " active" : "");
      b.textContent = "Saison " + season;
      b.addEventListener("click", () => {
        state.currentSeries.activeSeason = season;
        renderSeriesPanel();
      });
      seasonTabs.appendChild(b);
    });

    episodeList.innerHTML = "";
    (episodesBySeason[activeSeason] || []).forEach(ep => {
      const b = document.createElement("button");
      b.className = "episode-item";
      b.textContent = (ep.episode_num ? ep.episode_num + ". " : "") + (ep.title || "Épisode");
      b.addEventListener("click", () => {
        const epItem = { type: "episode", id: ep.id, name: `${item.name} — ${b.textContent}`, ext: ep.container_extension };
        Storage.pushHistory(epItem);
        openPlayerScreen(epItem);
        Player.play(epItem, { ts: XtreamAPI.seriesEpisodeUrl(ep.id, ep.container_extension) });
      });
      episodeList.appendChild(b);
    });
  }

  // ========================================================
  // PLAYER SCREEN
  // ========================================================
  function openPlayerScreen(item) {
    state.nowPlaying = item;
    playerTitle.textContent = item.name;
    playerStatus.hidden = true;
    updateFavoriteButton();
    showScreen(screenPlayer);
    setPlayIcon(true);
  }

  btnPlayerClose.addEventListener("click", closePlayer);
  function closePlayer() {
    Player.stop();
    showScreen(screenApp);
  }

  Player.on("status", (msg) => {
    if (!msg) { playerStatus.hidden = true; return; }
    playerStatus.hidden = false;
    playerStatus.textContent = msg;
  });
  Player.on("error", (msg) => {
    playerStatus.hidden = false;
    playerStatus.textContent = msg + " — nouvelle tentative possible avec le bouton lecture.";
  });

  btnPlayPause.addEventListener("click", () => {
    if (Player.video.paused) { Player.video.play(); } else { Player.video.pause(); }
  });
  Player.video.addEventListener("play", () => setPlayIcon(false));
  Player.video.addEventListener("pause", () => setPlayIcon(true));
  function setPlayIcon(showPlay) {
    iconPlay.hidden = !showPlay;
    iconPause.hidden = showPlay;
  }

  Player.video.addEventListener("timeupdate", () => {
    if (!Player.video.duration || !isFinite(Player.video.duration)) return;
    seekBar.max = Player.video.duration;
    seekBar.value = Player.video.currentTime;
    timeCurrent.textContent = formatTime(Player.video.currentTime);
    timeDuration.textContent = formatTime(Player.video.duration);
  });
  seekBar.addEventListener("input", () => { Player.video.currentTime = seekBar.value; });

  function formatTime(s) {
    if (!isFinite(s)) return "--:--";
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  volumeBar.addEventListener("input", () => { Player.video.volume = parseFloat(volumeBar.value); });

  btnFullscreen.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else playerWrap.requestFullscreen?.().catch(() => {});
  });

  btnFavorite.addEventListener("click", () => {
    if (!state.nowPlaying) return;
    const nowFav = Storage.toggleFavorite(state.nowPlaying);
    updateFavoriteButton(nowFav);
  });
  function updateFavoriteButton(forced) {
    if (!state.nowPlaying) return;
    const fav = forced !== undefined ? forced : Storage.isFavorite(state.nowPlaying.type, state.nowPlaying.id);
    btnFavorite.classList.toggle("active", fav);
  }

  // ========================================================
  // GLOBAL ERROR HANDLING (incl. session expiry)
  // ========================================================
  function handleApiError(err) {
    if (err && err.code === "AUTH") {
      toast("Session expirée. Reconnexion nécessaire.");
      Storage.clearSession();
      showScreen(screenLogin);
      return;
    }
    toast(describeError(err));
  }

  // ========================================================
  // INIT
  // ========================================================
  tryRestoreSession();
})();
