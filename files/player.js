/* =========================================================
   player.js
   Wraps the <video> element.

   IMPORTANT BROWSER LIMITATION (Tesla / Chromium-based browsers):
   Raw MPEG-TS (.ts) is NOT natively decodable by a plain <video src=...>
   in Chromium-based engines (which the Tesla browser is built on) — only
   Safari's native HLS stack handles that container out of the box.
   So per the brief we still *try* the raw .ts URL first (some Xtream
   panels serve content that plays fine, and it costs nothing to try),
   but if it fails to produce a playable stream within a short grace
   window, we fall back to the .m3u8 (HLS) variant of the same channel,
   played through a small MSE-based HLS engine (hls.js, lazy-loaded only
   when this fallback path is actually needed — never on the happy path).
   This keeps the common case dependency-free while still covering the
   Tesla browser's real-world constraint.
========================================================= */
const Player = (() => {
  const video = document.getElementById("video-el");
  let hls = null;
  let retryCount = 0;
  const MAX_RETRIES = 3;
  let currentMeta = null; // { kind, streamId, ext, title }
  let listeners = {};
  let tsGraceTimer = null;

  function on(evt, fn) { listeners[evt] = fn; }
  function emit(evt, payload) { if (listeners[evt]) listeners[evt](payload); }

  function teardown() {
    clearTimeout(tsGraceTimer);
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    video.removeAttribute("src");
    video.load();
  }

  // Entry point. `urls` = { ts, m3u8 } — either may be undefined depending on content type.
  function play(meta, urls) {
    teardown();
    retryCount = 0;
    currentMeta = meta;
    emit("status", "Connexion au flux…");

    if (urls.ts) {
      attemptDirect(urls);
    } else if (urls.m3u8) {
      attemptHls(urls.m3u8);
    } else {
      emit("error", "Aucune URL de flux disponible.");
    }
  }

  function attemptDirect(urls) {
    video.src = urls.ts;
    video.play().catch(() => {}); // Chromium requires a play() call to surface decode errors early

    // Grace window: if the browser can't demux raw .ts, no 'canplay'/'playing'
    // event will fire and an 'error' may or may not fire depending on engine.
    // Fall back proactively instead of waiting indefinitely.
    clearTimeout(tsGraceTimer);
    tsGraceTimer = setTimeout(() => {
      if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
        if (urls.m3u8) {
          emit("status", "Passage en HLS…");
          attemptHls(urls.m3u8);
        } else {
          emit("error", "Ce flux n'est pas lisible par ce navigateur.");
        }
      }
    }, 3500);
  }

  function attemptHls(m3u8Url) {
    clearTimeout(tsGraceTimer);

    // Safari / some embedded engines support HLS natively — cheapest path, no library.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = m3u8Url;
      video.play().catch(() => {});
      return;
    }

    loadHlsJs().then(() => {
      if (!window.Hls || !window.Hls.isSupported()) {
        emit("error", "Ce flux n'est pas compatible avec ce navigateur.");
        return;
      }
      hls = new window.Hls({
        maxBufferLength: 20,       // keep memory footprint modest
        maxMaxBufferLength: 30,
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(m3u8Url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        handleFatalHlsError(data, m3u8Url);
      });
      video.play().catch(() => {});
    }).catch(() => {
      emit("error", "Impossible de charger le lecteur HLS.");
    });
  }

  function handleFatalHlsError(data, m3u8Url) {
    if (retryCount >= MAX_RETRIES) {
      emit("error", "Flux indisponible après plusieurs tentatives.");
      return;
    }
    retryCount++;
    emit("status", `Reconnexion (${retryCount}/${MAX_RETRIES})…`);
    setTimeout(() => {
      switch (data.type) {
        case window.Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case window.Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          attemptHls(m3u8Url);
      }
    }, 1200 * retryCount); // simple backoff, kind to an unstable connection
  }

  let hlsJsPromise = null;
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve();
    if (hlsJsPromise) return hlsJsPromise;
    hlsJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return hlsJsPromise;
  }

  // native <video> level fallback (e.g. plain .ts truly refused, no m3u8 offered)
  video.addEventListener("error", () => {
    if (!currentMeta) return;
    emit("error", "Erreur de lecture du flux.");
  });

  video.addEventListener("stalled", () => emit("status", "Connexion instable…"));
  video.addEventListener("waiting", () => emit("status", "Mise en mémoire tampon…"));
  video.addEventListener("playing", () => emit("status", null));
  video.addEventListener("canplay", () => emit("status", null));

  // network drop mid-playback: try a clean reload of the same source once back online
  window.addEventListener("online", () => {
    if (currentMeta && (video.error || video.readyState === 0)) {
      emit("status", "Réseau rétabli, reprise…");
      video.load();
      video.play().catch(() => {});
    }
  });

  function stop() {
    teardown();
    currentMeta = null;
  }

  function getMeta() { return currentMeta; }

  return { video, play, stop, on, getMeta };
})();
