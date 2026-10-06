(() => {
  const VERSION = "0.12.2";
  const YARDS_PER_METER = 1.0936133;
  const STORE = "spotter-v041";
  const COLORS = ["#5ec8ff", "#e6c36a", "#d08cff", "#7ed38a"];

  const GAME_CATALOG = {
    closest: {
      id: "closest",
      label: "Closest to the Pin",
      steps: [
        ["First", "select the number of players."],
        ["Second", "select how many rounds for this session (default of 3)."],
        ["Third", "select how many balls each player gets."],
        ["Fourth", "update player names as needed."],
        ["Fifth", "open the range. Aim the phone, confirm your tee, then confirm the pin."]
      ]
    },
    longest: {
      id: "longest",
      label: "Longest Carry",
      steps: [
        ["First", "select the number of players."],
        ["Second", "select how many rounds for this session (default of 3)."],
        ["Third", "select how many balls each player gets."],
        ["Fourth", "update player names as needed."],
        ["Fifth", "open the range. Only balls inside the outline count. Each player gets one mulligan per round."]
      ]
    },
    ladder: {
      id: "ladder",
      label: "Ladder",
      steps: [
        ["First", "select the number of players."],
        ["Second", "select how many rounds for this session (default of 3)."],
        ["Third", "select how many balls each player gets."],
        ["Fourth", "update player names as needed."],
        ["Fifth", "open the range. Land inside the 50, 100, or 150 band. 1, 2, or 3 points. One mulligan per player."]
      ]
    }
  };

  const INDIAN_TREE = {
    name: "Indian Tree Golf Club",
    center: [39.83352, -105.08546],
    zoom: 18,
    heading: 330,
    bays: {
      right: [39.83307, -105.08375],
      center: [39.832712, -105.085185],
      left: [39.832544, -105.08539]
    },
    pins: {
      50: [39.833236, -105.085248],
      100: [39.833592, -105.085515],
      125: [39.83377, -105.085649],
      150: [39.833948, -105.085783],
      175: [39.834126, -105.085917],
      200: [39.834304, -105.086051]
    }
  };

  const state = {
    phase: "setup",
    names: ["Player 1", "Player 2"],
    game: "closest",
    shotsEach: 3,
    roundsPlanned: 3,
    handoffTo: null,
    placeName: "",
    usingReference: false,
    tee: null,
    pin: null,
    shots: [],
    lastYards: null,
    mapReady: false,
    games: [],
    sessionYards: {},
    gpsNote: "",
    corners: [],
    rangeHeading: 0,
    bearingNudge: 0,
    lockedHeading: null,
    teeLocked: false,
    mulliganUsed: [false, false, false, false],
    shareBlob: null
  };

  const els = {
    dock: document.getElementById("dock"),
    setup: document.getElementById("setupScreen"),
    score: document.getElementById("scoreScreen"),
    modeChip: document.getElementById("modeChip"),
    playerCount: document.getElementById("playerCount"),
    wrap2: document.getElementById("wrap2"),
    wrap3: document.getElementById("wrap3"),
    wrap4: document.getElementById("wrap4"),
    gameType: document.getElementById("gameType"),
    gameSteps: document.getElementById("gameSteps")
  };

  let map, teeMarker, pinMarker, shotLayer, ringLayer, rangeLayer;
  const CORNER_LABELS = [
    "Tee left — near-left corner of the hitting bays",
    "Tee right — near-right corner of the hitting bays",
    "Far right — down-range right corner",
    "Far left — down-range left corner"
  ];

  function destPoint(latlng, bearingDeg, yards) {
    const R = 6371000;
    const d = yards / YARDS_PER_METER;
    const br = (bearingDeg * Math.PI) / 180;
    const lat1 = (latlng[0] * Math.PI) / 180;
    const lon1 = (latlng[1] * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d / R) + Math.cos(lat1) * Math.sin(d / R) * Math.cos(br)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(br) * Math.sin(d / R) * Math.cos(lat1),
        Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
  }

  function bearingDeg(a, b) {
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;
    const dLon = ((b[1] - a[1]) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function midLatLng(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  function playerN() {
    return state.names.length;
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.count) els.playerCount.value = String(p.count);
      ["name1", "name2", "name3", "name4", "gameType"].forEach((id) => {
        if (p[id] == null || !document.getElementById(id)) return;
        const el = document.getElementById(id);
        const def = id.startsWith("name") ? `Player ${id.slice(-1)}` : "";
        el.value = p[id] === def ? "" : p[id];
      });
      if (p.useSavedBay && p.savedTee && p.savedPin) {
        document.getElementById("useSavedBay").checked = true;
      }
    } catch (_) {
      /* ignore */
    }
    syncNameFields();
  }

  function readSavedGeom() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (p.savedTee && p.savedPin) {
        return { tee: p.savedTee, pin: p.savedPin, corners: p.savedCorners || [] };
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function savePrefs() {
    const prev = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORE) || "{}");
      } catch (_) {
        return {};
      }
    })();
    localStorage.setItem(
      STORE,
      JSON.stringify({
        ...prev,
        count: els.playerCount.value,
        name1: document.getElementById("name1").value.trim(),
        name2: document.getElementById("name2").value.trim(),
        name3: document.getElementById("name3").value.trim(),
        name4: document.getElementById("name4").value.trim(),
        shots: document.getElementById("shots").value,
        rounds: document.getElementById("rounds") ? document.getElementById("rounds").value : "3",
        gameType: document.getElementById("gameType").value,
        useSavedBay: document.getElementById("useSavedBay").checked
      })
    );
  }

  function saveGeom() {
    const prev = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORE) || "{}");
      } catch (_) {
        return {};
      }
    })();
    prev.savedTee = state.tee;
    prev.savedPin = state.pin;
    prev.savedCorners = state.corners;
    localStorage.setItem(STORE, JSON.stringify(prev));
  }

  function syncNameFields() {
    const n = Number(els.playerCount.value);
    if (els.wrap2) els.wrap2.style.display = n >= 2 ? "" : "none";
    els.wrap3.style.display = n >= 3 ? "" : "none";
    els.wrap4.style.display = n >= 4 ? "" : "none";
  }

  function selectedGame() {
    const id = (els.gameType && els.gameType.value) || state.game || "closest";
    return GAME_CATALOG[id] || GAME_CATALOG.closest;
  }

  function renderGameSteps() {
    if (!els.gameSteps) return;
    const game = selectedGame();
    state.game = game.id;
    els.gameSteps.innerHTML = game.steps
      .map(([ord, text]) => `<li><strong>${ord}:</strong> ${text}</li>`)
      .join("");
  }

  function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const dLat = lat2 - lat1;
    const dLon = toRad(b[1] - a[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function yardsBetween(a, b) {
    return haversineMeters(a, b) * YARDS_PER_METER;
  }

  function isLongest() {
    return state.game === "longest";
  }

  function isLadder() {
    return state.game === "ladder";
  }

  function noPinGame() {
    return isLongest() || isLadder();
  }

  const LADDER = [
    { yd: 50, pts: 1 },
    { yd: 100, pts: 2 },
    { yd: 150, pts: 3 }
  ];

  function ladderStage(player) {
    const hit = new Set(
      state.shots.filter((s) => s.player === player && s.rung).map((s) => s.rung)
    );
    return LADDER.find((r) => !hit.has(r.yd)) || null;
  }

  function ladderHit(toTee, inPlay) {
    if (!inPlay || toTee == null) return null;
    return LADDER.find((r) => Math.abs(toTee - r.yd) <= 12) || null;
  }

  function inPlayArea(latlng) {
    if (!latlng || state.corners.length < 4) return true;
    const x = latlng[1];
    const y = latlng[0];
    const poly = state.corners;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][1];
      const yi = poly[i][0];
      const xj = poly[j][1];
      const yj = poly[j][0];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function scoringShots(player, shots) {
    return (shots || state.shots).filter((s) => {
      if (s.player !== player || s.missed || s.inPlay === false) return false;
      if (isLadder()) return s.points > 0;
      return isLongest() ? s.toTee != null : s.toPin != null;
    });
  }

  function fmt(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return `${Math.round(n)} yd`;
  }

  function setChip(label) {
    els.modeChip.textContent = `v0 · ${label}`;
  }

  function initMap() {
    if (state.mapReady) {
      setTimeout(() => map.invalidateSize(), 60);
      return;
    }
    map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
      rotate: true,
      bearing: 0
    }).setView(INDIAN_TREE.center, INDIAN_TREE.zoom);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles © Esri" }
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, opacity: 0.95 }
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, opacity: 0.7 }
    ).addTo(map);

    shotLayer = L.layerGroup().addTo(map);
    ringLayer = L.layerGroup().addTo(map);
    rangeLayer = L.layerGroup().addTo(map);
    state.mapReady = true;
    map.on("click", onMapClick);
    setTimeout(() => map.invalidateSize(), 80);
  }

  function divIcon(kind) {
    const bg = kind === "pin" ? "#e85d3a" : "#7ed38a";
    return L.divIcon({
      className: "spot-mark",
      html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${bg};border:2px solid #f4f1e8;box-shadow:0 0 0 2px rgba(0,0,0,.35)"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function setPlaceLabel(name) {
    state.placeName = name || "";
    const el = document.getElementById("siteLabel");
    if (el) el.textContent = name || "Any driving range";
  }

  function placeTee(latlng, skipDock, opts) {
    state.tee = latlng;
    if (teeMarker) map.removeLayer(teeMarker);
    teeMarker = L.marker(latlng, { icon: divIcon("tee"), draggable: true, zIndexOffset: 600 })
      .bindTooltip("Tee · drag to your bay", { permanent: true, direction: "top", offset: [0, -10] })
      .addTo(map);
    teeMarker.on("dragend", () => {
      const p = teeMarker.getLatLng();
      state.tee = [p.lat, p.lng];
      state.teeLocked = true;
      saveGeom();
      if (!state.usingReference) lookupPlace(state.tee);
      renderDock();
    });
    if (!opts || !opts.skipLookup) lookupPlace(latlng);
    if (!skipDock) renderDock();
  }

  async function lookupPlace(latlng) {
    if (!latlng) return;
    const [lat, lon] = latlng;
    try {
      const q = `[out:json][timeout:8];(
        nwr["golf"="driving_range"](around:900,${lat},${lon});
        nwr["leisure"="golf_course"](around:900,${lat},${lon});
      );out center 12;`;
      const over = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(q)}`
      });
      if (over.ok) {
        const data = await over.json();
        const named = (data.elements || [])
          .map((el) => {
            const c = el.center || { lat: el.lat, lon: el.lon };
            if (c.lat == null) return null;
            return {
              name: (el.tags && (el.tags.name || el.tags["name:en"])) || "",
              kind: el.tags && el.tags.golf === "driving_range" ? 0 : 1,
              d: haversineMeters(latlng, [c.lat, c.lon])
            };
          })
          .filter((x) => x && x.name)
          .sort((a, b) => a.kind - b.kind || a.d - b.d);
        if (named.length) {
          setPlaceLabel(`Near ${named[0].name}`);
          renderDock();
          return;
        }
      }
    } catch (_) {
      /* fall through */
    }
    try {
      const rev = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16`,
        { headers: { Accept: "application/json" } }
      );
      if (!rev.ok) return;
      const geo = await rev.json();
      const city =
        (geo.address && (geo.address.city || geo.address.town || geo.address.village || geo.address.suburb)) || "";
      const road = (geo.address && geo.address.road) || "";
      const label = [road, city].filter(Boolean).join(" · ") || geo.name || geo.display_name;
      if (label) setPlaceLabel(label.split(",")[0] + (city && !label.includes(city) ? ` · ${city}` : city ? "" : ""));
      if (city && !state.placeName) setPlaceLabel(city);
      if (!state.placeName && label) setPlaceLabel(String(label).split(",")[0]);
      renderDock();
    } catch (_) {
      /* ignore */
    }
  }

  function placePin(latlng, skipDock) {
    state.pin = latlng;
    if (pinMarker) map.removeLayer(pinMarker);
    pinMarker = L.marker(latlng, { icon: divIcon("pin"), draggable: true, zIndexOffset: 700 })
      .bindTooltip("Pin · drag onto the target", { permanent: true, direction: "top", offset: [0, -10] })
      .addTo(map);
    pinMarker.on("dragend", () => {
      const p = pinMarker.getLatLng();
      state.pin = [p.lat, p.lng];
      saveGeom();
      drawRings();
      renderDock();
    });
    drawRings();
    if (!skipDock) renderDock();
  }

  function applyRangeFrame() {
    if (state.corners.length < 4) return;
    const [teeL, teeR, farR, farL] = state.corners;
    const teeMid = midLatLng(teeL, teeR);
    const farMid = midLatLng(farL, farR);
    state.tee = teeMid;
    state.downrangeBearing = bearingDeg(teeMid, farMid);
    state.rangeHeading = state.lockedHeading != null
      ? state.lockedHeading
      : state.downrangeBearing;
    if (!state.teeLocked) {
      state.tee = teeMid;
      placeTee(teeMid, true, { skipLookup: state.usingReference });
    } else if (state.tee) {
      placeTee(state.tee, true, { skipLookup: true });
    }
    drawRangeGuides();
    spinTeeToBottom();
    setTimeout(() => {
      spinTeeToBottom();
      if (state.usingReference || teeLineAtBottom()) return;
      state.lockedHeading = (state.rangeHeading + 180) % 360;
      state.rangeHeading = state.lockedHeading;
      spinTeeToBottom();
    }, 140);
  }

  function teeLineAtBottom() {
    if (!map || state.corners.length < 4) return true;
    const [teeL, teeR, farR, farL] = state.corners;
    const tee = map.latLngToContainerPoint(L.latLng(midLatLng(teeL, teeR)));
    const far = map.latLngToContainerPoint(L.latLng(midLatLng(farL, farR)));
    return tee.y >= far.y;
  }

  function clearCssSpin() {
    if (!map) return;
    ["mapPane", "rotatePane", "tilePane", "overlayPane"].forEach((name) => {
      const p = map.getPane(name);
      if (p && p.style && p.style.transform) {
        p.style.transform = p.style.transform.replace(/rotate\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
      }
    });
  }

  function spinTeeToBottom() {
    if (!map || state.corners.length < 4) return;
    clearCssSpin();
    const faceUp = (state.rangeHeading + (state.bearingNudge || 0) + 360) % 360;
    map._rotate = true;
    map.options.rotate = true;
    const b = L.latLngBounds(state.corners.map((c) => L.latLng(c[0], c[1])));
    if (typeof map.setBearing === "function") map.setBearing(faceUp);
    map.fitBounds(b, { padding: [28, 28], animate: false, maxZoom: 19 });
    if (typeof map.setBearing === "function") map.setBearing(faceUp);
    map.invalidateSize();
  }

  function turnRange(deg) {
    const step = Number(deg) || 15;
    state.bearingNudge = ((state.bearingNudge || 0) + step + 360) % 360;
    spinTeeToBottom();
  }

  function drawRangeGuides() {
    if (!rangeLayer) return;
    rangeLayer.clearLayers();
    state.corners.forEach((c, i) => {
      L.circleMarker(c, {
        radius: 7,
        color: "#f4f1e8",
        weight: 2,
        fillColor: i < 2 ? "#7ed38a" : "#e6c36a",
        fillOpacity: 1
      })
        .bindTooltip(`C${i + 1}`, { permanent: true, direction: "top", offset: [0, -8] })
        .addTo(rangeLayer);
    });
    if (state.corners.length < 4) return;
    const [teeL, teeR, farR, farL] = state.corners;
    L.polygon([teeL, teeR, farR, farL], {
      color: "#f4f1e8",
      weight: 2,
      fillColor: "#7ed38a",
      fillOpacity: 0.06
    }).addTo(rangeLayer);
    const teeMid = midLatLng(teeL, teeR);
    const farMid = midLatLng(farL, farR);
    L.polyline([teeMid, farMid], {
      color: "#e6c36a",
      weight: 2,
      dashArray: "6 8",
      opacity: 0.9
    }).addTo(rangeLayer);
    const maxYd = Math.max(50, Math.round(yardsBetween(teeMid, farMid)));
    for (let yd = 50; yd <= maxYd; yd += 50) {
      const pt = destPoint(teeMid, state.downrangeBearing || bearingDeg(teeMid, farMid), yd);
      L.circleMarker(pt, {
        radius: 4,
        color: "#0d1c13",
        weight: 1,
        fillColor: "#e6c36a",
        fillOpacity: 1
      })
        .bindTooltip(`${yd}`, { permanent: true, direction: "right", offset: [8, 0], className: "yd-tip" })
        .addTo(rangeLayer);
    }
  }

  function drawRings() {
    ringLayer.clearLayers();
    if (!state.pin) return;
    [10, 20, 40].forEach((yd, i) => {
      L.circle(state.pin, {
        radius: yd / YARDS_PER_METER,
        color: i === 0 ? "#e85d3a" : "#f4f1e8",
        weight: i === 0 ? 2 : 1,
        fill: false,
        opacity: 0.7 - i * 0.15
      }).addTo(ringLayer);
    });
  }

  function redrawShots() {
    shotLayer.clearLayers();
    state.shots.forEach((s, idx) => {
      if (s.missed || !s.latlng) return;
      L.circleMarker(s.latlng, {
        radius: 7,
        color: "#0d1c13",
        weight: 1,
        fillColor: s.inPlay === false ? "#8a8f86" : COLORS[s.player],
        fillOpacity: 0.95
      })
        .bindTooltip(
          `${state.names[s.player]} #${idx + 1} · ${s.inPlay === false ? "out of play" : isLadder() ? `${s.points || 0} pts` : fmt(isLongest() ? s.toTee : s.toPin)}`,
          { direction: "top" }
        )
        .addTo(shotLayer);
    });
  }

  function counts() {
    return state.names.map((_, i) => state.shots.filter((s) => s.player === i).length);
  }

  function bestOf(player) {
    const list = scoringShots(player);
    if (!list.length) return null;
    return list.reduce((a, b) => {
      if (isLongest()) return a.toTee > b.toTee ? a : b;
      return a.toPin < b.toPin ? a : b;
    });
  }

  function avgOf(player, shots) {
    const list = scoringShots(player, shots);
    if (!list.length) return null;
    const key = isLongest() ? "toTee" : "toPin";
    return list.reduce((sum, s) => sum + s[key], 0) / list.length;
  }

  function avgWinnersOf(shots, names) {
    const avgs = names.map((_, i) => avgOf(i, shots));
    const valid = avgs.filter((v) => v != null);
    if (!valid.length) return { names: [], avgs };
    const best = isLongest() || isLadder() ? Math.max(...valid) : Math.min(...valid);
    return { names: names.filter((_, i) => avgs[i] === best), avgs };
  }

  function fmtAvg(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return `${Math.round(n)} yd avg`;
  }

  function sessionAvgs() {
    const avgs = {};
    state.names.forEach((n) => {
      const list = state.sessionYards[n] || [];
      avgs[n] = list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
    });
    const valid = Object.values(avgs).filter((v) => v != null);
    if (!valid.length) return { avgs, names: [] };
    const best = isLongest() || isLadder() ? Math.max(...valid) : Math.min(...valid);
    return { avgs, names: state.names.filter((n) => avgs[n] === best) };
  }

  function currentPlayer() {
    const c = counts();
    for (let i = 0; i < playerN(); i += 1) {
      if (c[i] < state.shotsEach) return i;
    }
    return null;
  }

  function onMapClick(e) {
    const latlng = [e.latlng.lat, e.latlng.lng];
    if (state.phase === "tee" || state.phase === "calibrate") {
      state.teeLocked = true;
      placeTee(latlng);
      return;
    }
    if (state.phase === "outline" || state.phase === "corners") {
      state.usingReference = false;
      state.lockedHeading = null;
      if (state.corners.length < 4) {
        state.corners.push(latlng);
        drawRangeGuides();
        if (state.corners.length === 4) {
          state.gpsNote = "";
          applyRangeFrame();
        }
        renderDock();
      }
      return;
    }
    if (state.phase === "pin") {
      placePin(latlng);
      return;
    }
    if (state.phase === "play") {
      if (state.handoffTo != null) return;
      markShot(latlng, false);
    }
  }

  function markShot(latlng, missed) {
    if (state.handoffTo != null) return;
    const player = currentPlayer();
    if (player == null) return;
    if (!noPinGame() && !state.pin) return;
    const toPin = missed || !state.pin ? null : yardsBetween(latlng, state.pin);
    const toTee = missed || !state.tee ? null : yardsBetween(latlng, state.tee);
    const inPlay = missed ? false : inPlayArea(latlng);
    const stage = isLadder() ? ladderStage(player) : null;
    const near = isLadder() ? ladderHit(toTee, inPlay) : null;
    const hit = stage && near && near.yd === stage.yd ? stage : null;
    state.shots.push({
      player,
      latlng: missed ? null : latlng,
      toPin,
      toTee,
      missed,
      inPlay,
      points: hit ? hit.pts : 0,
      rung: hit ? hit.yd : null,
      at: Date.now()
    });
    state.lastYards = isLadder() ? (hit ? hit.pts : 0) : isLongest() ? toTee : toPin;
    state.lastNote = !missed && !inPlay
      ? "Out of play — does not count"
      : isLadder()
        ? hit
          ? `${hit.yd} · next is ${ladderStage(player) ? ladderStage(player).yd : "done"}`
          : stage
            ? `Going for ${stage.yd}. That was not the ${stage.yd} band.`
            : "Ladder complete"
        : "";
    redrawShots();
    if (isLadder()) drawLadder();
    const next = currentPlayer();
    if (next == null) finishGame();
    else if (next !== player) {
      state.handoffTo = next;
      renderDock();
    } else renderDock();
  }

  function useMulligan(player) {
    if (player == null || state.mulliganUsed[player]) return;
    let idx = -1;
    state.shots.forEach((s, i) => {
      if (s.player === player) idx = i;
    });
    if (idx < 0) return;
    state.shots.splice(idx, 1);
    state.mulliganUsed[player] = true;
    state.handoffTo = null;
    state.lastNote = "Mulligan used. Hit again.";
    redrawShots();
    renderDock();
  }

  function undoShot() {
    state.shots.pop();
    const last = state.shots[state.shots.length - 1];
    state.lastYards = last && !last.missed ? (isLongest() ? last.toTee : last.toPin) : null;
    state.lastNote = "";
    redrawShots();
    renderDock();
  }

  function bestLine(player, count) {
    const shots = scoringShots(player);
    const mull = state.mulliganUsed[player] ? " · mulligan used" : "";
    if (isLadder()) {
      const pts = shots.reduce((sum, s) => sum + (s.points || 0), 0);
      const stage = ladderStage(player);
      return `${count}/${state.shotsEach} · ${stage ? `going for ${stage.yd}` : "ladder done"} · ${pts} pts${mull}`;
    }
    const best = bestOf(player);
    const value = best ? fmt(isLongest() ? best.toTee : best.toPin) : null;
    return `${count}/${state.shotsEach} · ${value ? `best ${value}` : "no mark"}${mull}`;
  }

  function winnersOf(shots, names) {
    const bests = names.map((_, i) => {
      const list = scoringShots(i, shots);
      if (!list.length) return null;
      if (isLadder()) return list.reduce((sum, s) => sum + (s.points || 0), 0);
      return list.reduce((a, b) => {
        if (isLongest()) return a.toTee > b.toTee ? a : b;
        return a.toPin < b.toPin ? a : b;
      })[isLongest() ? "toTee" : "toPin"];
    });
    const valid = bests.filter((v) => v != null);
    if (!valid.length) return { names: [], bests };
    const best = isLongest() || isLadder() ? Math.max(...valid) : Math.min(...valid);
    return { names: names.filter((_, i) => bests[i] === best), bests };
  }

  function finishGame() {
    const result = winnersOf(state.shots, state.names);
    const avg = avgWinnersOf(state.shots, state.names);
    state.names.forEach((n, i) => {
      if (!state.sessionYards[n]) state.sessionYards[n] = [];
      state.shots
        .filter((s) => s.player === i && !s.missed && s.inPlay !== false && (isLadder() ? s.points > 0 : isLongest() ? s.toTee != null : s.toPin != null))
        .forEach((s) => state.sessionYards[n].push(isLadder() ? s.points : isLongest() ? s.toTee : s.toPin));
    });
    state.handoffTo = null;
    state.games.push({
      at: Date.now(),
      names: state.names.slice(),
      winners: result.names,
      bests: result.bests,
      avgWinners: avg.names,
      avgs: avg.avgs,
      shotCount: state.shots.length,
      place: state.placeName || ""
    });
    saveGeom();
    state.phase = "score";
    setChip("Score");
    renderScore();
    renderDock();
  }

  function sessionWins() {
    const tally = {};
    state.names.forEach((n) => {
      tally[n] = 0;
    });
    let ties = 0;
    state.games.forEach((g) => {
      if (g.winners.length === 1) {
        const w = g.winners[0];
        tally[w] = (tally[w] || 0) + 1;
      } else if (g.winners.length > 1) ties += 1;
    });
    return { tally, ties };
  }

  function renderScore() {
    const result = winnersOf(state.shots, state.names);
    const avg = avgWinnersOf(state.shots, state.names);
    const winWord = isLadder() ? "ladder" : isLongest() ? "longest carry" : "closest tap";
    let headline = "It's a tie.";
    if (result.names.length === 1) headline = `${result.names[0]} ${winWord}`;
    else if (result.names.length > 1) headline = `${winWord} tie: ${result.names.join(" & ")}`;
    let avgLine = "No averages yet.";
    if (avg.names.length === 1) avgLine = `${avg.names[0]}`;
    else if (avg.names.length > 1) avgLine = avg.names.join(" & ");
    const sameHonor =
      result.names.length === 1 && avg.names.length === 1 && result.names[0] === avg.names[0];
    const honorLabel = isLadder() ? "ladder points" : isLongest() ? "longest carry" : "closest to the pin";
    const honorHtml = sameHonor
      ? `<div class="honor champ"><div class="honor-label">Winner · ${honorLabel} and best average</div><h2>${headline}</h2></div>`
      : `<div class="honor champ"><div class="honor-label">Winner · ${honorLabel}</div><h2>${headline}</h2></div>
         <div class="honor runner"><div class="honor-label">Runner-up · best average</div><h2>${avgLine}</h2></div>`;

    const { tally, ties } = sessionWins();
    const ranked = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a.localeCompare(b));
    const leader = ranked[0];
    const leadWins = ranked.length ? tally[leader] : 0;
    const leaders = ranked.filter((n) => tally[n] === leadWins && leadWins > 0);
    let sessionLine = "No games in the bag yet.";
    if (state.games.length) {
      if (leaders.length === 1) sessionLine = `${leaders[0]} leads the session ${leadWins}–${ranked.map((n) => tally[n]).join("–")}`;
      else if (leaders.length > 1) sessionLine = `Session tied: ${leaders.join(" & ")} (${leadWins} each)`;
    }

    const playerCards = state.names
      .map((n, i) => {
        const best = bestOf(i);
        const mean = avgOf(i);
        return `<div class="player p${i + 1}">
          <div class="name">${n}</div>
          <div class="meta">Best ${best ? fmt(isLongest() ? best.toTee : best.toPin) : "—"} · ${fmtAvg(mean)} · ${tally[n] || 0} wins</div>
        </div>`;
      })
      .join("");

    const shotsHtml = state.shots
      .map((s, i) => {
        if (s.missed) {
          return `<div class="shot">
            <span class="dot" style="background:${COLORS[s.player]}"></span>
            <div>
              <div>${state.names[s.player]} · shot ${i + 1}</div>
              <div class="tiny">did not see it</div>
            </div>
            <strong>—</strong>
          </div>`;
        }
        const carry = s.toTee != null ? ` · carry ${fmt(s.toTee)}` : "";
        return `<div class="shot">
          <span class="dot" style="background:${COLORS[s.player]}"></span>
          <div>
            <div>${state.names[s.player]} · shot ${i + 1}</div>
            <div class="tiny">${s.inPlay === false ? "out of play — does not count" : `tap mark${carry}`}</div>
          </div>
          <strong>${s.inPlay === false ? "—" : isLadder() ? `${s.points || 0} pts` : fmt(isLongest() ? s.toTee : s.toPin)}</strong>
        </div>`;
      })
      .join("");

    const gamesHtml = state.games
      .map((g, i) => {
        const label =
          g.winners.length === 1 ? g.winners[0] : g.winners.length ? `Tie · ${g.winners.join(" & ")}` : "No mark";
        return `<div class="shot">
          <span class="dot" style="background:#7ed38a"></span>
          <div>
            <div>Game ${i + 1}</div>
            <div class="tiny">${g.shotCount} taps${g.avgWinners && g.avgWinners.length ? ` · avg ${g.avgWinners.join(" & ")}` : ""}</div>
          </div>
          <strong>${label}</strong>
        </div>`;
      })
      .join("");

    els.score.innerHTML = `
      <div class="tiny">${selectedGame().label} · v${VERSION} · round ${state.games.length} of ${state.roundsPlanned}${state.placeName ? ` · ${state.placeName}` : ""}</div>
      <div class="winner">
        <div class="tiny">This game · ${selectedGame().label}</div>
        ${honorHtml}
        <div class="row">${playerCards}</div>
      </div>
      <div class="winner" style="margin-top:12px">
        <div class="tiny">Session</div>
        <h2 style="margin:4px 0 6px">${sessionLine}</h2>
        <p class="lede" style="margin:0">${state.games.length} game${state.games.length === 1 ? "" : "s"}${ties ? ` · ${ties} tie${ties === 1 ? "" : "s"}` : ""}</p>
      </div>
      <p class="lede">${isLadder() ? "50, 100, and 150 are 12-yard bands from the tee. Inside the outline: 1, 2, or 3 points." : isLongest() ? "Carry counts only inside the outline. One mulligan per player each round." : "Distance is from the spotter tap to the pin. Treat it as a game mark, not a launch monitor."}</p>
      <div class="tiny">This game</div>
      <div class="list">${shotsHtml || "<p class='lede'>No shots recorded.</p>"}</div>
      <div class="tiny">All games this visit</div>
      <div class="list">${gamesHtml}</div>
      ${
        state.games.length < state.roundsPlanned
          ? `<button class="btn wide" id="replayBtn">Play round ${state.games.length + 1} of ${state.roundsPlanned}</button>
      <div style="height:8px"></div>
      <button class="btn secondary wide" id="endSessionBtn">End session</button>`
          : `<button class="btn wide" id="endSessionBtn">End session</button>
      <div style="height:8px"></div>
      <button class="btn ghost wide" id="replayBtn">Play extra round</button>`
      }
    `;
    els.score.classList.remove("hidden");
    document.getElementById("replayBtn").onclick = replaySame;
    document.getElementById("endSessionBtn").onclick = endSession;
  }

  function sessionHeadline() {
    const { tally, ties } = sessionWins();
    const ranked = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a.localeCompare(b));
    const leadWins = ranked.length ? tally[ranked[0]] : 0;
    const leaders = ranked.filter((n) => tally[n] === leadWins && leadWins > 0);
    if (!state.games.length) return { line: "No games in this session.", tally, ties, ranked };
    if (leaders.length === 1) {
      return {
        line: `${leaders[0]} won the session`,
        tally,
        ties,
        ranked
      };
    }
    return {
      line: `Session tied: ${leaders.join(" & ")}`,
      tally,
      ties,
      ranked
    };
  }

  function endSession() {
    state.phase = "recap";
    setChip("Session");
    const { line, tally, ties, ranked } = sessionHeadline();
    const scoreLine = ranked.map((n) => `${n} ${tally[n]}`).join(" · ");
    const gamesHtml = state.games
      .map((g, i) => {
        const label =
          g.winners.length === 1 ? g.winners[0] : g.winners.length ? `Tie · ${g.winners.join(" & ")}` : "No mark";
        return `<div class="shot">
          <span class="dot" style="background:#7ed38a"></span>
          <div>
            <div>Game ${i + 1}</div>
            <div class="tiny">${g.shotCount} taps${g.avgWinners && g.avgWinners.length ? ` · avg ${g.avgWinners.join(" & ")}` : ""}</div>
          </div>
          <strong>${label}</strong>
        </div>`;
      })
      .join("");
    const sessAvg = sessionAvgs();
    let avgHonor = "No averages this session.";
    if (sessAvg.names.length === 1) {
      avgHonor = `${sessAvg.names[0]} · ${fmtAvg(sessAvg.avgs[sessAvg.names[0]])}`;
    } else if (sessAvg.names.length > 1) {
      avgHonor = sessAvg.names.map((n) => `${n} · ${fmtAvg(sessAvg.avgs[n])}`).join(" & ");
    }
    const sameSessionHonor =
      line.indexOf("won the session") !== -1 &&
      sessAvg.names.length === 1 &&
      line.startsWith(sessAvg.names[0]);
    const sessionHonors = sameSessionHonor
      ? `<div class="honor champ"><div class="honor-label">Winner · session and best average</div><h2>${line}</h2></div>`
      : `<div class="honor champ"><div class="honor-label">Winner</div><h2>${line}</h2></div>
         <div class="honor runner"><div class="honor-label">Runner-up · best average</div><h2>${avgHonor}</h2></div>`;
    const cards = state.names
      .map((n, i) => `<div class="player p${i + 1}">
        <div class="name">${n}</div>
        <div class="meta">${tally[n] || 0} win${tally[n] === 1 ? "" : "s"} · ${fmtAvg(sessAvg.avgs[n])}</div>
      </div>`)
      .join("");

    els.score.innerHTML = `
      <div class="tiny">Session recap · v${VERSION} · ${selectedGame().label}${state.placeName ? ` · ${state.placeName}` : ""}</div>
      <div class="winner">
        <div class="tiny">${state.games.length} game${state.games.length === 1 ? "" : "s"}${ties ? ` · ${ties} tie${ties === 1 ? "" : "s"}` : ""}</div>
        ${sessionHonors}
        <p class="lede" style="margin:0 0 10px">${scoreLine || "No wins recorded."}</p>
        <div class="row">${cards}</div>
      </div>
      <img class="share-card" id="sharePreview" alt="Results card" />
      <div class="tiny">All games this visit</div>
      <div class="list">${gamesHtml || "<p class='lede'>No games recorded.</p>"}</div>
      <button class="btn wide" id="shareBtn">Share results card</button>
      <div style="height:8px"></div>
      <button class="btn secondary wide" id="homeBtn">Back to setup</button>
    `;
    els.score.classList.remove("hidden");
    document.getElementById("shareBtn").onclick = shareSession;
    document.getElementById("homeBtn").onclick = resetToSetup;
    paintShareCard().then((url) => {
      const img = document.getElementById("sharePreview");
      if (img && url) img.src = url;
    });
  }

  function paintShareCard() {
    const { line, tally, ranked } = sessionHeadline();
    const sessAvg = sessionAvgs();
    const w = 1080;
    const h = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#12261a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1b3324";
    ctx.fillRect(48, 48, w - 96, h - 96);
    ctx.strokeStyle = "rgba(230,195,106,.45)";
    ctx.lineWidth = 4;
    ctx.strokeRect(48, 48, w - 96, h - 96);
    ctx.fillStyle = "#2e7d46";
    ctx.fillRect(80, 80, 72, 72);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 40px Trebuchet MS, sans-serif";
    ctx.fillText("S", 100, 130);
    ctx.font = "700 52px Trebuchet MS, sans-serif";
    ctx.fillText("Spotter", 172, 128);
    ctx.fillStyle = "#b7c4b4";
    ctx.font = "28px Trebuchet MS, sans-serif";
    ctx.fillText(state.placeName || "Driving range", 172, 168);
    ctx.fillStyle = "#e6c36a";
    ctx.font = "700 22px Trebuchet MS, sans-serif";
    ctx.fillText("WINNER", 80, 260);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 48px Trebuchet MS, sans-serif";
    wrapText(ctx, line, 80, 320, w - 160, 56);
    ctx.fillStyle = "#5ec8ff";
    ctx.font = "700 22px Trebuchet MS, sans-serif";
    ctx.fillText("RUNNER-UP  ·  BEST AVERAGE", 80, 470);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 40px Trebuchet MS, sans-serif";
    const avgNames = sessAvg.names.length
      ? sessAvg.names.map((n) => `${n}  ${fmtAvg(sessAvg.avgs[n])}`).join("  ·  ")
      : "No average";
    wrapText(ctx, avgNames, 80, 524, w - 160, 48);
    let y = 640;
    ranked.forEach((n, i) => {
      ctx.fillStyle = COLORS[Math.min(i, COLORS.length - 1)];
      ctx.fillRect(80, y, 18, 18);
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "700 32px Trebuchet MS, sans-serif";
      ctx.fillText(n, 114, y + 22);
      ctx.fillStyle = "#b7c4b4";
      ctx.font = "28px Trebuchet MS, sans-serif";
      ctx.fillText(`${tally[n] || 0} wins   ${fmtAvg(sessAvg.avgs[n])}`, 114, y + 58);
      y += 100;
    });
    ctx.fillStyle = "#b7c4b4";
    ctx.font = "24px Trebuchet MS, sans-serif";
    ctx.fillText(`${state.games.length} round${state.games.length === 1 ? "" : "s"}  ·  ${selectedGame().label}`, 80, h - 100);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        state.shareBlob = blob;
        resolve(blob ? URL.createObjectURL(blob) : "");
      }, "image/png");
    });
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = String(text).split(" ");
    let line = "";
    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineH;
      } else line = test;
    });
    if (line) ctx.fillText(line, x, y);
  }

  function sessionShareText() {
    const { line, tally, ties, ranked } = sessionHeadline();
    const sessAvg = sessionAvgs();
    const lines = [
      `Spotter · ${selectedGame().label}`,
      state.placeName || "Driving range",
      line,
      ranked.map((n) => `${n}: ${tally[n] || 0} win${tally[n] === 1 ? "" : "s"} · ${fmtAvg(sessAvg.avgs[n])}`).join("\n"),
      ties ? `${ties} tie${ties === 1 ? "" : "s"}` : "",
      `${state.games.length} round${state.games.length === 1 ? "" : "s"}`
    ].filter(Boolean);
    return lines.join("\n");
  }

  async function shareSession() {
    const text = sessionShareText();
    if (!state.shareBlob) await paintShareCard();
    const file = state.shareBlob
      ? new File([state.shareBlob], "spotter-results.png", { type: "image/png" })
      : null;
    try {
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: "Spotter results", text, files: [file] });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Spotter results", text });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    if (state.shareBlob) {
      const url = URL.createObjectURL(state.shareBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spotter-results.png";
      a.click();
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      alert("Results copied. Paste them into a text or message.");
    } catch (_) {
      prompt("Copy results:", text);
    }
  }

  function replaySame() {
    state.shots = [];
    state.lastYards = null;
    state.lastNote = "";
    state.handoffTo = null;
    state.mulliganUsed = [false, false, false, false];
    state.phase = "play";
    els.score.classList.add("hidden");
    setChip("Play");
    redrawShots();
    renderDock();
    setTimeout(() => map.invalidateSize(), 60);
  }

  function resetToSetup() {
    state.phase = "setup";
    state.shots = [];
    state.lastYards = null;
    state.games = [];
    state.sessionYards = {};
    state.handoffTo = null;
    state.usingReference = false;
    state.corners = [];
    state.rangeHeading = 0;
    state.lockedHeading = null;
    if (map && typeof map.setBearing === "function") map.setBearing(0);
    clearCssSpin();
    els.score.classList.add("hidden");
    els.setup.classList.remove("hidden");
    setChip("Setup");
    if (map && shotLayer) redrawShots();
    els.dock.innerHTML = "";
  }

  function gpsErrorText(err) {
    if (!err) return "Could not read GPS. Tap the map on your bay instead.";
    if (err.code === 1) return "Location permission denied. In the phone browser, allow Location for this site, then tap Use my GPS again.";
    if (err.code === 2) return "Phone has no position yet. Step outside or tap the map on your bay.";
    if (err.code === 3) return "GPS timed out. Tap Use my GPS again, or tap the map.";
    return "Could not read GPS. Tap the map on your bay instead.";
  }

  function applyIndianTreeReference(reason) {
    if (!state.mapReady) initMap();
    state.usingReference = true;
    state.teeLocked = false;
    state.bearingNudge = 0;
    state.lockedHeading = 70;
    state.corners = [
      [39.83306148486516, -105.08417624992578],
      [39.83372830136809, -105.08388755105248],
      [39.83466082043433, -105.0859150351995],
      [39.833782711619044, -105.08680594187898]
    ];
    map.setView(INDIAN_TREE.center, 17);
    applyRangeFrame();
    if (!noPinGame()) placePin(INDIAN_TREE.pins[150], true);
    saveGeom();
    setPlaceLabel("Spotter Range");
    state.phase = "aim";
    setChip("Aim");
    state.gpsNote = reason || "Spotter Range is aimed. Confirm the pads, then your tee, then the pin.";
    renderDock();
  }

  function clearReferenceMarks() {
    state.usingReference = false;
    state.teeLocked = false;
    state.lockedHeading = null;
    state.corners = [];
    state.pin = null;
    if (pinMarker) {
      map.removeLayer(pinMarker);
      pinMarker = null;
    }
    if (ringLayer) ringLayer.clearLayers();
    if (rangeLayer) rangeLayer.clearLayers();
    if (typeof map.setBearing === "function") map.setBearing(0);
    clearCssSpin();
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      state.gpsNote = "This phone has no GPS. Stay on Spotter Range, or pan the map yourself.";
      renderDock();
      return;
    }
    state.gpsNote = "Finding you… allow Location if the phone asks.";
    renderDock();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        const acc = Math.round(pos.coords.accuracy);
        clearReferenceMarks();
        map.setView(latlng, 18);
        placeTee(latlng, true);
        state.teeLocked = true;
        saveGeom();
        lookupPlace(latlng);
        state.phase = "outline";
        setChip("Range");
        state.gpsNote = acc
          ? `You are here (~${acc} m). Tap the four corners of this range.`
          : "You are here. Tap the four corners of this range.";
        renderDock();
      },
      (err) => {
        state.gpsNote = `${gpsErrorText(err)} Spotter Range is still on the map.`;
        renderDock();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function useGpsForTee() {
    if (!navigator.geolocation) {
      applyIndianTreeReference("This browser has no GPS. Spotter Range is the stand-in layout.");
      return;
    }
    state.gpsNote = "Finding your bay… allow Location if the phone asks.";
    renderDock();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        const acc = Math.round(pos.coords.accuracy);
        state.usingReference = false;
        map.setView(latlng, 18);
        if (state.phase !== "corners") {
          placeTee(latlng);
          saveGeom();
        }
        state.gpsNote = acc
          ? `Tee set from GPS (~${acc} m). Drag if it is off your pad.`
          : "Tee set from GPS. Drag if it is off your pad.";
        renderDock();
      },
      (err) => {
        applyIndianTreeReference(`${gpsErrorText(err)} Spotter Range is on the map so you can still play.`);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function startSession() {
    savePrefs();
    const n = Math.max(1, Math.min(4, Number(els.playerCount.value) || 2));
    const raw = [
      document.getElementById("name1").value.trim() || "Player 1",
      document.getElementById("name2").value.trim() || "Player 2",
      document.getElementById("name3").value.trim() || "Player 3",
      document.getElementById("name4").value.trim() || "Player 4"
    ];
    state.names = raw.slice(0, n);
    const allowed = [3, 4, 5];
    const rawShots = Number(document.getElementById("shots").value);
    state.shotsEach = allowed.includes(rawShots) ? rawShots : 3;
    const rawRounds = Number(document.getElementById("rounds") && document.getElementById("rounds").value);
    state.roundsPlanned = [1, 2, 3, 4, 5].includes(rawRounds) ? rawRounds : 3;
    const gameEl = document.getElementById("gameType");
    state.game = gameEl && gameEl.value ? gameEl.value : "closest";
    state.shots = [];
    state.lastYards = null;
    state.lastNote = "";
    state.handoffTo = null;
    state.mulliganUsed = [false, false, false, false];
    state.usingReference = false;
    state.placeName = "";
    setPlaceLabel("Any driving range");
    const useSaved = document.getElementById("useSavedBay").checked;
    const saved = readSavedGeom();

    els.setup.classList.add("hidden");
    initMap();
    redrawShots();

    if (useSaved && saved) {
      if (saved.corners && saved.corners.length === 4) {
        state.corners = saved.corners;
        applyRangeFrame();
      } else {
        placeTee(saved.tee, true);
        state.teeLocked = true;
      }
      if (saved.pin) placePin(saved.pin, true);
      if (state.tee && (state.pin || noPinGame())) {
        enterPlay();
        return;
      }
    }

    applyIndianTreeReference();
  }

  function enterPlay() {
    if (!state.tee) return;
    if (!noPinGame() && !state.pin) return;
    state.phase = "play";
    setChip("Play");
    saveGeom();
    renderDock();
    redrawShots();
    if (state.corners.length === 4) {
      drawRangeGuides();
      spinTeeToBottom();
    } else if (state.pin) map.fitBounds(L.latLngBounds([state.tee, state.pin]).pad(0.6));
    drawLadder();
    if (!isLadder() && state.pin) drawRings();
    setTimeout(() => map.invalidateSize(), 60);
  }

  function drawLadder() {
    if (!ringLayer || !isLadder() || !state.tee) return;
    ringLayer.clearLayers();
    LADDER.forEach((r) => {
      L.circle(state.tee, {
        radius: r.yd / YARDS_PER_METER,
        color: "#e6c36a",
        weight: 2,
        fill: false,
        opacity: 0.85
      }).addTo(ringLayer);
      const heading = state.downrangeBearing || state.rangeHeading || 0;
      const pt = destPoint(state.tee, heading, r.yd);
      L.circleMarker(pt, { radius: 5, color: "#143021", fillColor: "#e6c36a", fillOpacity: 1 })
        .bindTooltip(`${r.yd} · ${r.pts} pts`, { permanent: true, direction: "right" })
        .addTo(ringLayer);
    });
  }

  function renderDock() {
    if (state.phase === "setup" || state.phase === "score" || state.phase === "recap") {
      els.dock.innerHTML = "";
      return;
    }

    if (state.phase === "aim") {
      els.dock.innerHTML = `
        <div class="tiny">Step 1 of ${noPinGame() ? "2" : "3"} · Aim the phone</div>
        <p style="margin:4px 0 10px">Turn the map until the tee pads are at the bottom of the phone.</p>
        <div class="btn-row" style="grid-template-columns:1fr 1fr 1.4fr">
          <button class="btn secondary" id="turnLeft">↺ 15°</button>
          <button class="btn secondary" id="turnRight">15° ↻</button>
          <button class="btn" id="aimNext">Pads look right</button>
        </div>
        <button class="btn ghost wide" id="hereBtn" style="margin-top:8px">I'm at a different range</button>
      `;
      document.getElementById("turnLeft").onclick = () => turnRange(-15);
      document.getElementById("turnRight").onclick = () => turnRange(15);
      document.getElementById("aimNext").onclick = () => {
        state.phase = "tee";
        setChip("Tee");
        renderDock();
      };
      document.getElementById("hereBtn").onclick = useMyLocation;
      return;
    }

    if (state.phase === "outline" || state.phase === "corners") {
      const n = state.corners.length;
      const prompts = [
        "Tap the left edge of the tee box.",
        "Tap the right edge of the tee box.",
        "Tap the far-right corner of the landing area.",
        "Tap the far-left corner of the landing area."
      ];
      els.dock.innerHTML = `
        <div class="tiny">Outline · corner ${Math.min(n + 1, 4)} of 4</div>
        <p style="margin:4px 0 10px">${n < 4 ? (state.gpsNote || prompts[n]) : "Box set. Tee line is at the bottom. Next, confirm your tee."}</p>
        <div class="btn-row" style="grid-template-columns:1fr 1fr">
          <button class="btn ghost" id="undoCorner" ${n ? "" : "disabled"}>Undo</button>
          <button class="btn secondary" id="hereBtn">Find me</button>
        </div>
        <button class="btn" id="outlineNext" style="margin-top:8px" ${n === 4 ? "" : "disabled"}>Tee next</button>
        <button class="btn ghost wide" id="refBtn" style="margin-top:8px">Use Spotter Range</button>
      `;
      document.getElementById("undoCorner").onclick = () => {
        state.corners.pop();
        state.gpsNote = "";
        state.lockedHeading = null;
        drawRangeGuides();
        renderDock();
      };
      document.getElementById("hereBtn").onclick = useMyLocation;
      document.getElementById("outlineNext").onclick = () => {
        if (state.corners.length < 4) return;
        applyRangeFrame();
        state.phase = "tee";
        setChip("Tee");
        renderDock();
      };
      document.getElementById("refBtn").onclick = () => applyIndianTreeReference();
      return;
    }

    if (state.phase === "tee" || state.phase === "calibrate") {
      els.dock.innerHTML = `
        <div class="tiny">Step 2 of ${noPinGame() ? "2" : "3"} · Tee</div>
        <p style="margin:4px 0 10px">${noPinGame() ? "Drag the green tee onto your bay. No pin for this game." : "Drag the green tee onto your bay, or tap the pad you are standing on."}</p>
        <div class="btn-row" style="grid-template-columns:1fr 1.4fr">
          <button class="btn secondary" id="backAim">Back</button>
          <button class="btn" id="teeNext" ${state.tee ? "" : "disabled"}>${noPinGame() ? "Start game" : "Tee is here"}</button>
        </div>
      `;
      document.getElementById("backAim").onclick = () => {
        state.phase = state.corners.length === 4 && !state.usingReference ? "outline" : "aim";
        setChip(state.phase === "outline" ? "Range" : "Aim");
        renderDock();
      };
      document.getElementById("teeNext").onclick = () => {
        if (!state.tee) return;
        state.teeLocked = true;
        if (noPinGame()) {
          enterPlay();
          return;
        }
        if (!state.pin && state.usingReference) placePin(INDIAN_TREE.pins[150], true);
        state.phase = "pin";
        setChip("Pin");
        renderDock();
      };
      return;
    }

    if (state.phase === "pin") {
      const dist = state.tee && state.pin ? fmt(yardsBetween(state.tee, state.pin)) : "—";
      els.dock.innerHTML = `
        <div class="tiny">Step 3 of 3 · Target · ${dist} from tee</div>
        <p style="margin:4px 0 10px">Tap the closest flag you can see. Drag the orange pin if it lands off the flag.</p>
        <div class="btn-row" style="grid-template-columns:1fr 1.4fr">
          <button class="btn secondary" id="backTee">Back</button>
          <button class="btn" id="startPlay" ${state.pin ? "" : "disabled"}>Start game</button>
        </div>
      `;
      document.getElementById("backTee").onclick = () => {
        state.phase = "tee";
        setChip("Tee");
        renderDock();
      };
      document.getElementById("startPlay").onclick = enterPlay;
      return;
    }

    if (state.phase === "play") {
      if (state.handoffTo != null) {
        const nxt = state.handoffTo;
        const done = state.names[nxt - 1] || "Last player";
        const donePlayer = nxt - 1;
        const canMulligan = donePlayer >= 0 && !state.mulliganUsed[donePlayer] && state.shots.some((s) => s.player === donePlayer);
        els.dock.innerHTML = `
          <div class="tiny">Round ${state.games.length + 1} of ${state.roundsPlanned} · ${state.placeName || "Spotter"}</div>
          <p style="margin:4px 0 10px">${done} is done. Hand the phone over, then start ${state.names[nxt]}.</p>
          <button class="btn wide" id="handoffBtn">Start ${state.names[nxt]}</button>
          <button class="btn secondary wide" id="mulliganBtn" style="margin-top:8px" ${canMulligan ? "" : "disabled"}>Mulligan for ${done}</button>
        `;
        document.getElementById("handoffBtn").onclick = () => {
          state.handoffTo = null;
          renderDock();
        };
        document.getElementById("mulliganBtn").onclick = () => useMulligan(donePlayer);
        return;
      }
      const player = currentPlayer();
      const c = counts();
      const last = state.shots[state.shots.length - 1];
      const lastTxt = last
        ? last.missed
          ? "missed"
          : last.inPlay === false
            ? "out"
            : fmt(isLongest() ? last.toTee : last.toPin)
        : "—";
      const mulliganPlayer = player != null ? player : null;
      const canMulligan =
        mulliganPlayer != null &&
        !state.mulliganUsed[mulliganPlayer] &&
        state.shots.some((s) => s.player === mulliganPlayer);
      const cards = state.names
        .map((n, i) => {
          return `<div class="player p${i + 1} ${player === i ? "active" : ""}">
            <div class="name">${n}</div>
            <div class="meta">${bestLine(i, c[i])}</div>
          </div>`;
        })
        .join("");
      els.dock.innerHTML = `
        <div class="banner" style="margin-bottom:8px">
          <div>
            <div class="tiny">${
              player == null
                ? "Game complete"
                : `Round ${state.games.length + 1} of ${state.roundsPlanned} · ${state.names[player]} hits all ${state.shotsEach}`
            }</div>
            <div class="big" style="font-size:18px">${
              player == null
                ? "See score"
                : isLadder()
                  ? `Going for ${ladderStage(player) ? ladderStage(player).yd : "done"}`
                  : `${state.names[player]} · ${c[player] + 1} of ${state.shotsEach}`
            }</div>
          </div>
          <div style="text-align:right">
            <div class="tiny">${isLadder() ? "This shot" : isLongest() ? "Last carry" : "Last to pin"}</div>
            <div class="big" style="font-size:18px">${isLadder() && last && last.rung ? `${last.rung}` : lastTxt}</div>
          </div>
        </div>
        <div class="scoreline" style="margin-bottom:8px">${cards}</div>
        ${state.lastNote ? `<p class="lede" style="margin:0 0 8px">${state.lastNote}</p>` : ""}
        <div class="btn-row" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr">
          <button class="btn ghost" id="undoBtn" ${state.shots.length ? "" : "disabled"}>Undo</button>
          <button class="btn secondary" id="missBtn" ${player == null ? "disabled" : ""}>Missed</button>
          <button class="btn secondary" id="movePin">Pin</button>
          <button class="btn secondary" id="turnLeft">↺</button>
          <button class="btn secondary" id="turnRight">↻</button>
          <button class="btn danger" id="endBtn">End</button>
        </div>
        <button class="btn secondary wide" id="mulliganBtn" style="margin-top:8px" ${canMulligan ? "" : "disabled"}>Mulligan · 1 per player</button>
      `;
      document.getElementById("undoBtn").onclick = undoShot;
      document.getElementById("missBtn").onclick = () => markShot(null, true);
      document.getElementById("mulliganBtn").onclick = () => useMulligan(player);
      document.getElementById("movePin").onclick = () => {
        state.phase = "pin";
        setChip("Pin");
        renderDock();
      };
      document.getElementById("turnLeft").onclick = () => turnRange(-15);
      document.getElementById("turnRight").onclick = () => turnRange(15);
      document.getElementById("endBtn").onclick = finishGame;
    }
  }

  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1 && !e.target.closest("#map")) e.preventDefault();
    },
    { passive: false }
  );

  els.playerCount.addEventListener("change", syncNameFields);
  if (els.gameType) els.gameType.addEventListener("change", renderGameSteps);
  document.getElementById("startBtn").onclick = startSession;
  document.getElementById("cardBtn").onclick = openCard;
  document.getElementById("seeCardBtn").onclick = showSavedCard;

  const cardState = {
    course: "",
    side: "front",
    player: 0,
    names: ["Player 1", "Player 2"],
    pars: Array(18).fill(4),
    scores: [],
    saved: false
  };

  function cardNames() {
    const n = Math.max(1, Math.min(4, Number(els.playerCount.value) || 2));
    return [1, 2, 3, 4].slice(0, n).map((i) => {
      const el = document.getElementById("name" + i);
      return (el && el.value.trim()) || "Player " + i;
    });
  }

  function loadCard() {
    try {
      const raw = JSON.parse(localStorage.getItem("spotter-card") || "{}");
      cardState.course = raw.course || "";
      cardState.side = raw.side || "front";
      cardState.pars = Array.isArray(raw.pars) && raw.pars.length === 18 ? raw.pars : Array(18).fill(4);
      cardState.names = raw.names && raw.names.length ? raw.names : cardNames();
      cardState.scores = raw.scores && raw.scores.length === cardState.names.length
        ? raw.scores
        : cardState.names.map(() => Array(18).fill(null));
      cardState.saved = !!raw.savedAt;
    } catch (_) {
      cardState.names = cardNames();
      cardState.scores = cardState.names.map(() => Array(18).fill(null));
    }
  }

  function saveCard(done) {
    localStorage.setItem("spotter-card", JSON.stringify({
      course: cardState.course,
      side: cardState.side,
      pars: cardState.pars,
      names: cardState.names,
      scores: cardState.scores,
      savedAt: done ? Date.now() : null
    }));
  }

  function holeRange() {
    if (cardState.side === "back") return [9, 18];
    if (cardState.side === "all") return [0, 18];
    return [0, 9];
  }

  function cardTotals(player) {
    const [a, b] = holeRange();
    let strokes = 0;
    let par = 0;
    let played = 0;
    for (let i = a; i < b; i += 1) {
      const s = cardState.scores[player][i];
      if (s == null) continue;
      strokes += s;
      par += cardState.pars[i];
      played += 1;
    }
    return { strokes, par, played, vs: strokes - par };
  }

  function fmtVs(n) {
    if (!n) return "E";
    return n > 0 ? `+${n}` : String(n);
  }

  function openCard() {
    loadCard();
    const freshNames = cardNames();
    if (freshNames.join("|") !== cardState.names.join("|")) {
      cardState.names = freshNames;
      cardState.scores = freshNames.map(() => Array(18).fill(null));
    }
    cardState.player = 0;
    cardState.saved = false;
    document.getElementById("setupScreen").classList.add("hidden");
    document.getElementById("cardScreen").classList.remove("hidden");
    setChip("Card");
    renderCard();
  }

  function renderCard() {
    const screen = document.getElementById("cardScreen");
    const [a, b] = holeRange();
    const p = cardState.player;
    const tot = cardTotals(p);
    const chips = cardState.names.map((n, i) =>
      `<button class="btn secondary ${i === p ? "active" : ""}" data-player="${i}">${n}</button>`
    ).join("");
    const holes = [];
    for (let i = a; i < b; i += 1) {
      const score = cardState.scores[p][i];
      holes.push(`<div class="hole">
        <div class="hole-no">${i + 1}</div>
        <div class="par-step">
          <span class="tiny">Par</span>
          <button class="step-btn" data-par="${i}" data-d="-1">−</button>
          <span>${cardState.pars[i]}</span>
          <button class="step-btn" data-par="${i}" data-d="1">+</button>
        </div>
        <div class="score-step">
          <button class="step-btn" data-score="${i}" data-d="-1">−</button>
          <span class="score-val">${score == null ? "—" : score}</span>
          <button class="step-btn" data-score="${i}" data-d="1">+</button>
        </div>
      </div>`);
    }
    screen.innerHTML = `
      <div class="tiny">Score a round</div>
      <h2 style="margin-bottom:8px">Scorecard</h2>
      <label for="courseName">Course</label>
      <input id="courseName" type="text" placeholder="Course name" />
      <div class="btn-row three" style="margin-top:10px">
        <button class="btn ${cardState.side === "front" ? "" : "secondary"}" data-side="front">Front 9</button>
        <button class="btn ${cardState.side === "back" ? "" : "secondary"}" data-side="back">Back 9</button>
        <button class="btn ${cardState.side === "all" ? "" : "secondary"}" data-side="all">18</button>
      </div>
      <div class="chips">${chips}</div>
      ${holes.join("")}
      <div class="card-total">
        <div class="tiny">${cardState.names[p]} · ${tot.played} holes scored</div>
        <div class="big">${tot.played ? fmtVs(tot.vs) : "—"} <span style="font-size:14px;color:var(--muted)">${tot.played ? tot.strokes + " strokes" : ""}</span></div>
      </div>
      <button class="btn wide" id="cardShare" style="margin-top:12px">Share results card</button>
      <div style="height:8px"></div>
      <button class="btn danger wide" id="cardClear">Clear scores</button>
      <div style="height:8px"></div>
      <button class="btn ghost wide" id="cardBack">Back to setup</button>
      <img class="share-card" id="cardPreview" alt="Scorecard" style="margin-top:12px" />
    `;
    const courseEl = screen.querySelector("#courseName");
    courseEl.value = cardState.course;
    courseEl.oninput = (e) => {
      cardState.course = e.target.value;
      saveCard(false);
    };
    screen.querySelectorAll("[data-side]").forEach((btn) => {
      btn.onclick = () => {
        cardState.side = btn.dataset.side;
        saveCard(false);
        renderCard();
      };
    });
    screen.querySelectorAll("[data-player]").forEach((btn) => {
      btn.onclick = () => {
        cardState.player = Number(btn.dataset.player);
        renderCard();
      };
    });
    screen.querySelectorAll("[data-par]").forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.par);
        cardState.pars[i] = Math.max(3, Math.min(6, cardState.pars[i] + Number(btn.dataset.d)));
        saveCard(false);
        renderCard();
      };
    });
    screen.querySelectorAll("[data-score]").forEach((btn) => {
      btn.onclick = () => {
        const i = Number(btn.dataset.score);
        const cur = cardState.scores[p][i];
        const d = Number(btn.dataset.d);
        if (cur == null) cardState.scores[p][i] = d > 0 ? cardState.pars[i] : null;
        else cardState.scores[p][i] = Math.max(1, cur + d);
        saveCard(false);
        renderCard();
      };
    });
    screen.querySelector("#cardShare").onclick = shareCard;
    screen.querySelector("#cardClear").onclick = clearCardScores;
    paintCardShare().then((url) => {
      const img = document.getElementById("cardPreview");
      if (img && url) img.src = url;
    });
    screen.querySelector("#cardBack").onclick = () => {
      saveCard(cardState.saved);
      screen.classList.add("hidden");
      document.getElementById("setupScreen").classList.remove("hidden");
      setChip("Setup");
    };
  }

  function clearCardScores() {
    cardState.scores = cardState.names.map(() => Array(18).fill(null));
    cardState.saved = false;
    saveCard(false);
    if (document.getElementById("setupScreen").classList.contains("hidden")) {
      if (document.getElementById("cardPreview") && document.getElementById("courseName")) renderCard();
      else showSavedCard();
    }
  }

  function showSavedCard() {
    loadCard();
    const screen = document.getElementById("cardScreen");
    document.getElementById("setupScreen").classList.add("hidden");
    screen.classList.remove("hidden");
    setChip("Card");
    const [a, b] = holeRange();
    const rows = cardState.names.map((n, i) => {
      const t = cardTotals(i);
      const holes = cardState.scores[i].slice(a, b).map((s) => (s == null ? "·" : s)).join(" ");
      return `<div class="shot"><span class="dot" style="background:${COLORS[i]}"></span><div><div>${n}</div><div class="tiny">${holes}</div></div><strong>${t.played ? fmtVs(t.vs) : "—"}</strong></div>`;
    }).join("");
    screen.innerHTML = `
      <div class="tiny">Saved scorecard</div>
      <h2>${cardState.course || "Golf round"}</h2>
      <p class="lede">${cardState.side === "back" ? "Back 9" : cardState.side === "all" ? "18 holes" : "Front 9"}</p>
      <div class="list">${rows || "<p class='lede'>No scorecard yet. Score a golf round first.</p>"}</div>
      <img class="share-card" id="cardPreview" alt="Scorecard" />
      <button class="btn wide" id="cardShare">Share results card</button>
      <div style="height:8px"></div>
      <button class="btn danger wide" id="cardClear">Clear scores</button>
      <div style="height:8px"></div>
      <button class="btn ghost wide" id="cardBack">Back to setup</button>
    `;
    paintCardShare().then((url) => {
      const img = document.getElementById("cardPreview");
      if (img && url) img.src = url;
    });
    screen.querySelector("#cardShare").onclick = shareCard;
    screen.querySelector("#cardClear").onclick = clearCardScores;
    screen.querySelector("#cardBack").onclick = () => {
      screen.classList.add("hidden");
      document.getElementById("setupScreen").classList.remove("hidden");
      setChip("Setup");
    };
  }

  function paintCardShare() {
    const w = 1080;
    const h = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e7f0e4";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#143021";
    ctx.fillRect(0, 0, w, 168);
    ctx.fillStyle = "#e6c36a";
    ctx.font = "700 28px Trebuchet MS, sans-serif";
    ctx.fillText("SPOTTER SCORECARD", 56, 62);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 46px Trebuchet MS, sans-serif";
    wrapText(ctx, cardState.course || "Golf round", 56, 118, 700, 48);
    ctx.font = "28px Trebuchet MS, sans-serif";
    ctx.fillStyle = "#b7c4b4";
    const side = cardState.side === "back" ? "Back 9" : cardState.side === "all" ? "18 holes" : "Front 9";
    ctx.fillText(side, 780, 118);

    const blocks = cardState.side === "all" ? [[0, 9, "Out"], [9, 18, "In"]] : [holeRange().concat([cardState.side === "back" ? "In" : "Out"])];
    let y = 210;
    blocks.forEach(([start, end, label]) => {
      y = drawCardBlock(ctx, start, end, label, 40, y);
      y += 28;
    });
    if (cardState.side === "all") {
      const barH = 50 + cardState.names.length * 40;
      ctx.fillStyle = "#143021";
      ctx.fillRect(40, y, 1000, barH);
      ctx.fillStyle = "#e6c36a";
      ctx.font = "700 24px Trebuchet MS, sans-serif";
      ctx.fillText("Total", 56, y + 34);
      cardState.names.forEach((n, i) => {
        const t = cardTotals(i);
        ctx.fillStyle = "#f4f1e8";
        ctx.font = "700 26px Trebuchet MS, sans-serif";
        ctx.fillText(n, 220, y + 36 + i * 40);
        ctx.fillStyle = "#e6c36a";
        ctx.fillText(t.played ? `${t.strokes}    ${fmtVs(t.vs)}` : "—", 520, y + 36 + i * 40);
      });
    }
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        state.shareBlob = blob;
        resolve(blob ? URL.createObjectURL(blob) : "");
      }, "image/png");
    });
  }

  function drawCardBlock(ctx, start, end, totalLabel, x, y) {
    const holes = [];
    for (let i = start; i < end; i += 1) holes.push(i);
    const labelW = 170;
    const cell = 78;
    const rowH = 54;
    const rows = 2 + cardState.names.length;
    const width = labelW + holes.length * cell + cell;
    ctx.fillStyle = "#143021";
    ctx.fillRect(x, y, width, rowH);
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 22px Trebuchet MS, sans-serif";
    ctx.fillText("Hole", x + 16, y + 34);
    holes.forEach((hole, i) => {
      ctx.fillText(String(hole + 1), x + labelW + i * cell + 24, y + 34);
    });
    ctx.fillText(totalLabel, x + labelW + holes.length * cell + 16, y + 34);
    const body = [
      ["Par", holes.map((h) => String(cardState.pars[h])), String(holes.reduce((s, h) => s + cardState.pars[h], 0))],
      ...cardState.names.map((n, pi) => {
        const scores = holes.map((h) => (cardState.scores[pi][h] == null ? "" : String(cardState.scores[pi][h])));
        const played = holes.filter((h) => cardState.scores[pi][h] != null);
        const strokes = played.reduce((s, h) => s + cardState.scores[pi][h], 0);
        return [n, scores, played.length ? String(strokes) : ""];
      })
    ];
    body.forEach((row, r) => {
      const ry = y + rowH * (r + 1);
      ctx.fillStyle = r === 0 ? "#d7e4d4" : r % 2 ? "#f7fbf6" : "#e7f0e4";
      ctx.fillRect(x, ry, width, rowH);
      ctx.strokeStyle = "#143021";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, ry, width, rowH);
      ctx.fillStyle = "#143021";
      ctx.font = "700 22px Trebuchet MS, sans-serif";
      ctx.fillText(row[0].slice(0, 10), x + 16, ry + 34);
      row[1].forEach((val, i) => {
        ctx.font = "28px Trebuchet MS, sans-serif";
        ctx.fillText(val, x + labelW + i * cell + 24, ry + 36);
      });
      ctx.font = "700 24px Trebuchet MS, sans-serif";
      ctx.fillText(row[2], x + labelW + holes.length * cell + 16, ry + 36);
    });
    return y + rowH * rows;
  }

  async function shareCard() {
    await paintCardShare();
    const text = ["Spotter scorecard", cardState.course || "Golf round", ...cardState.names.map((n, i) => {
      const t = cardTotals(i);
      return `${n}: ${t.played ? fmtVs(t.vs) + " · " + t.strokes + " strokes" : "no scores"}`;
    })].join("\n");
    const file = state.shareBlob ? new File([state.shareBlob], "spotter-scorecard.png", { type: "image/png" }) : null;
    try {
      if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: "Spotter scorecard", text, files: [file] });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Spotter scorecard", text });
        return;
      }
    } catch (_) {
      /* fall through */
    }
    const url = URL.createObjectURL(state.shareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spotter-scorecard.png";
    a.click();
  }

  const reloadBtn = document.getElementById("reloadBtn");
  if (reloadBtn) reloadBtn.onclick = forceLatest;

  async function forceLatest() {
    reloadBtn.disabled = true;
    reloadBtn.textContent = "Clearing old copy…";
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (_) {
      /* still reload */
    }
    const url = new URL(location.href);
    url.searchParams.set("v", VERSION);
    url.searchParams.set("r", String(Date.now()));
    location.replace(url.toString());
  }

  loadPrefs();
  renderGameSteps();
  setChip("Setup");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
