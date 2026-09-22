(() => {
  const VERSION = "0.7.9";
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
        ["Fifth", "mark the four corners of the range, then the PIN. The tee box sits at the bottom of the phone."]
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
    shotsEach: 5,
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
    bearingNudge: 0
  };

  const els = {
    dock: document.getElementById("dock"),
    setup: document.getElementById("setupScreen"),
    score: document.getElementById("scoreScreen"),
    modeChip: document.getElementById("modeChip"),
    playerCount: document.getElementById("playerCount"),
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
        if (p[id] != null && document.getElementById(id)) document.getElementById(id).value = p[id];
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
    state.rangeHeading = bearingDeg(teeMid, farMid);
    placeTee(teeMid, true, { skipLookup: state.usingReference });
    drawRangeGuides();
    spinTeeToBottom();
    setTimeout(spinTeeToBottom, 120);
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
      const pt = destPoint(teeMid, state.rangeHeading || bearingDeg(teeMid, farMid), yd);
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
        fillColor: COLORS[s.player],
        fillOpacity: 0.95
      })
        .bindTooltip(`${state.names[s.player]} #${idx + 1} · ${fmt(s.toPin)}`, { direction: "top" })
        .addTo(shotLayer);
    });
  }

  function counts() {
    return state.names.map((_, i) => state.shots.filter((s) => s.player === i).length);
  }

  function bestOf(player) {
    const list = state.shots.filter((s) => s.player === player && !s.missed && s.toPin != null);
    if (!list.length) return null;
    return list.reduce((a, b) => (a.toPin < b.toPin ? a : b));
  }

  function avgOf(player, shots) {
    const list = (shots || state.shots).filter((s) => s.player === player && !s.missed && s.toPin != null);
    if (!list.length) return null;
    return list.reduce((sum, s) => sum + s.toPin, 0) / list.length;
  }

  function avgWinnersOf(shots, names) {
    const avgs = names.map((_, i) => avgOf(i, shots));
    const valid = avgs.filter((v) => v != null);
    if (!valid.length) return { names: [], avgs };
    const low = Math.min(...valid);
    return { names: names.filter((_, i) => avgs[i] === low), avgs };
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
    const low = Math.min(...valid);
    return { avgs, names: state.names.filter((n) => avgs[n] === low) };
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
    if (state.phase === "calibrate" || state.phase === "corners") {
      state.usingReference = false;
      if (state.phase === "calibrate") {
        placeTee(latlng);
        return;
      }
      if (state.corners.length < 4) {
        state.corners.push(latlng);
        drawRangeGuides();
        if (state.corners.length === 4) applyRangeFrame();
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
    if (player == null || !state.pin) return;
    const toPin = missed ? null : yardsBetween(latlng, state.pin);
    const toTee = missed || !state.tee ? null : yardsBetween(latlng, state.tee);
    state.shots.push({
      player,
      latlng: missed ? null : latlng,
      toPin,
      toTee,
      missed,
      at: Date.now()
    });
    state.lastYards = toPin;
    redrawShots();
    const next = currentPlayer();
    if (next == null) finishGame();
    else if (next !== player) {
      state.handoffTo = next;
      renderDock();
    } else renderDock();
  }

  function undoShot() {
    state.shots.pop();
    const last = state.shots[state.shots.length - 1];
    state.lastYards = last && !last.missed ? last.toPin : null;
    redrawShots();
    renderDock();
  }

  function bestLine(player, count) {
    const best = bestOf(player);
    const bestTxt = best ? `best ${fmt(best.toPin)}` : "no mark";
    return `${count}/${state.shotsEach} · ${bestTxt}`;
  }

  function winnersOf(shots, names) {
    const bests = names.map((_, i) => {
      const list = shots.filter((s) => s.player === i && !s.missed && s.toPin != null);
      if (!list.length) return null;
      return list.reduce((a, b) => (a.toPin < b.toPin ? a : b)).toPin;
    });
    const valid = bests.filter((v) => v != null);
    if (!valid.length) return { names: [], bests };
    const low = Math.min(...valid);
    const winners = names.filter((_, i) => bests[i] === low);
    return { names: winners, bests };
  }

  function finishGame() {
    const result = winnersOf(state.shots, state.names);
    const avg = avgWinnersOf(state.shots, state.names);
    state.names.forEach((n, i) => {
      if (!state.sessionYards[n]) state.sessionYards[n] = [];
      state.shots
        .filter((s) => s.player === i && !s.missed && s.toPin != null)
        .forEach((s) => state.sessionYards[n].push(s.toPin));
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
    let headline = "It's a tie.";
    if (result.names.length === 1) headline = `${result.names[0]} closest tap`;
    else if (result.names.length > 1) headline = `Closest tap tie: ${result.names.join(" & ")}`;
    let avgLine = "No averages yet.";
    if (avg.names.length === 1) avgLine = `${avg.names[0]} best average`;
    else if (avg.names.length > 1) avgLine = `Average tie: ${avg.names.join(" & ")}`;

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
          <div class="meta">Best ${best ? fmt(best.toPin) : "—"} · ${fmtAvg(mean)} · ${tally[n] || 0} wins</div>
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
            <div class="tiny">tap mark${carry}</div>
          </div>
          <strong>${fmt(s.toPin)}</strong>
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
      <div class="tiny">Closest to the pin · v${VERSION} · round ${state.games.length} of ${state.roundsPlanned}${state.placeName ? ` · ${state.placeName}` : ""}</div>
      <div class="winner">
        <div class="tiny">This game · ${selectedGame().label}</div>
        <h2 style="margin:4px 0 6px">${headline}</h2>
        <p class="lede" style="margin:0 0 10px">${avgLine}</p>
        <div class="row">${playerCards}</div>
      </div>
      <div class="winner" style="margin-top:12px">
        <div class="tiny">Session</div>
        <h2 style="margin:4px 0 6px">${sessionLine}</h2>
        <p class="lede" style="margin:0">${state.games.length} game${state.games.length === 1 ? "" : "s"}${ties ? ` · ${ties} tie${ties === 1 ? "" : "s"}` : ""}</p>
      </div>
      <p class="lede">Distance is from the spotter tap to the pin. Treat it as a game mark, not a launch monitor.</p>
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
      avgHonor = `${sessAvg.names[0]} best average ${fmtAvg(sessAvg.avgs[sessAvg.names[0]])}`;
    } else if (sessAvg.names.length > 1) {
      avgHonor = `Average tied: ${sessAvg.names.join(" & ")}`;
    }
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
        <h2 style="margin:4px 0 6px">${line}</h2>
        <p class="lede" style="margin:0 0 8px">${scoreLine || "No wins recorded."}</p>
        <p class="lede" style="margin:0 0 10px">${avgHonor}</p>
        <div class="row">${cards}</div>
      </div>
      <div class="tiny">All games this visit</div>
      <div class="list">${gamesHtml || "<p class='lede'>No games recorded.</p>"}</div>
      <button class="btn wide" id="shareBtn">Share results</button>
      <div style="height:8px"></div>
      <button class="btn secondary wide" id="homeBtn">Back to setup</button>
    `;
    els.score.classList.remove("hidden");
    document.getElementById("shareBtn").onclick = shareSession;
    document.getElementById("homeBtn").onclick = resetToSetup;
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
    try {
      if (navigator.share) {
        await navigator.share({ title: "Spotter results", text });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
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
    state.handoffTo = null;
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
    if (map && typeof map.setBearing === "function") map.setBearing(0);
    clearCssSpin();
    els.score.classList.add("hidden");
    els.setup.classList.remove("hidden");
    setChip("Setup");
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
    state.bearingNudge = 0;
    state.corners = [
      [39.83306148486516, -105.08417624992578],
      [39.83372830136809, -105.08388755105248],
      [39.83466082043433, -105.0859150351995],
      [39.833782711619044, -105.08680594187898]
    ];
    map.setView(INDIAN_TREE.center, 17);
    applyRangeFrame();
    placePin(INDIAN_TREE.pins[150], true);
    saveGeom();
    setPlaceLabel("Spotter Range");
    state.phase = "pin";
    setChip("Pin");
    state.gpsNote =
      reason ||
      "Spotter Range is on the map as a stand-in layout. Drag Tee and Pin, or play it as-is.";
    renderDock();
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
    const n = Math.max(2, Math.min(4, Number(els.playerCount.value) || 2));
    const raw = [
      document.getElementById("name1").value.trim() || "Player 1",
      document.getElementById("name2").value.trim() || "Player 2",
      document.getElementById("name3").value.trim() || "Player 3",
      document.getElementById("name4").value.trim() || "Player 4"
    ];
    state.names = raw.slice(0, n);
    const allowed = [3, 4, 5];
    const rawShots = Number(document.getElementById("shots").value);
    state.shotsEach = allowed.includes(rawShots) ? rawShots : 5;
    const rawRounds = Number(document.getElementById("rounds") && document.getElementById("rounds").value);
    state.roundsPlanned = [1, 2, 3, 4, 5].includes(rawRounds) ? rawRounds : 3;
    const gameEl = document.getElementById("gameType");
    state.game = gameEl && gameEl.value ? gameEl.value : "closest";
    state.shots = [];
    state.lastYards = null;
    state.gpsNote = "";
    state.handoffTo = null;
    state.usingReference = false;
    state.placeName = "";
    setPlaceLabel("Any driving range");
    const useSaved = document.getElementById("useSavedBay").checked;
    const saved = readSavedGeom();

    els.setup.classList.add("hidden");
    initMap();

    if (useSaved && saved) {
      if (saved.corners && saved.corners.length === 4) {
        state.corners = saved.corners;
        applyRangeFrame();
      } else {
        placeTee(saved.tee, true);
      }
      if (saved.pin) placePin(saved.pin, true);
      if (state.tee && state.pin) {
        enterPlay();
        return;
      }
    }

    state.corners = [];
    state.rangeHeading = 0;
    state.phase = "corners";
    setChip("Range");
    map.setView(INDIAN_TREE.center, 17);
    if (typeof map.setBearing === "function") map.setBearing(0);
    renderDock();
    useGpsForTee();
  }

  function enterPlay() {
    if (!state.tee || !state.pin) return;
    state.phase = "play";
    setChip("Play");
    saveGeom();
    renderDock();
    if (state.corners.length === 4) applyRangeFrame();
    else map.fitBounds(L.latLngBounds([state.tee, state.pin]).pad(0.6));
    setTimeout(() => map.invalidateSize(), 60);
  }

  function renderDock() {
    if (state.phase === "setup" || state.phase === "score" || state.phase === "recap") {
      els.dock.innerHTML = "";
      return;
    }

    if (state.phase === "corners") {
      const n = state.corners.length;
      els.dock.innerHTML = `
        <div class="tiny">Range box · ${n} of 4 corners</div>
        <p style="margin:4px 0 10px">${n < 4 ? CORNER_LABELS[n] : "Box set. Tee is the bottom of the phone. Next: pin."}</p>
        <div class="btn-row" style="grid-template-columns:${n === 4 ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr"}">
          <button class="btn ghost" id="undoCorner" ${n ? "" : "disabled"}>Undo</button>
          <button class="btn secondary" id="refBtn">Spotter Range</button>
          ${n === 4 ? `<button class="btn secondary" id="turnLeft">↺ 15°</button>
          <button class="btn secondary" id="turnRight">15° ↻</button>` : ""}
          <button class="btn" id="cornersNext" ${n === 4 ? "" : "disabled"}>Set pin next</button>
        </div>
      `;
      document.getElementById("undoCorner").onclick = () => {
        state.corners.pop();
        if (typeof map.setBearing === "function") map.setBearing(0);
        drawRangeGuides();
        renderDock();
      };
      document.getElementById("refBtn").onclick = () => applyIndianTreeReference();
      const turnLeft = document.getElementById("turnLeft");
      const turnRight = document.getElementById("turnRight");
      if (turnLeft) turnLeft.onclick = () => turnRange(-15);
      if (turnRight) turnRight.onclick = () => turnRange(15);
      document.getElementById("cornersNext").onclick = () => {
        if (state.corners.length < 4) return;
        applyRangeFrame();
        state.phase = "pin";
        setChip("Pin");
        renderDock();
      };
      return;
    }

    if (state.phase === "calibrate") {
      els.dock.innerHTML = `
        <div class="tiny">Step 1 of 2 · TEE</div>
        <p style="margin:4px 0 10px">${state.gpsNote || "Use GPS for the pad you are standing on, or tap that spot on the map."}</p>
        <div class="btn-row" style="grid-template-columns:1fr 1fr 1fr">
          <button class="btn secondary" id="gpsBtn">Use my GPS</button>
          <button class="btn secondary" id="refBtn">Spotter Range</button>
          <button class="btn" id="teeNext" ${state.tee ? "" : "disabled"}>Set pin next</button>
        </div>
      `;
      document.getElementById("gpsBtn").onclick = useGpsForTee;
      document.getElementById("refBtn").onclick = () => applyIndianTreeReference();
      document.getElementById("teeNext").onclick = () => {
        if (!state.tee) return;
        state.phase = "pin";
        setChip("Pin");
        renderDock();
      };
      return;
    }

    if (state.phase === "pin") {
      const dist = state.tee && state.pin ? fmt(yardsBetween(state.tee, state.pin)) : "—";
      els.dock.innerHTML = `
        <div class="tiny">Step 2 of 2 · PIN · ${dist} from tee</div>
        <p style="margin:4px 0 10px">Tap the closest target you can see. Drag the orange pin if it lands off the flag.</p>
        <div class="btn-row" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr">
          <button class="btn secondary" id="backCal">Back</button>
          <button class="btn secondary" id="refBtn">Spotter Range</button>
          <button class="btn secondary" id="turnLeft">↺ 15°</button>
          <button class="btn secondary" id="turnRight">15° ↻</button>
          <button class="btn" id="startPlay" ${state.pin ? "" : "disabled"}>Start game</button>
        </div>
      `;
      document.getElementById("backCal").onclick = () => {
        state.phase = "corners";
        setChip("Range");
        renderDock();
      };
      document.getElementById("refBtn").onclick = () => applyIndianTreeReference();
      document.getElementById("turnLeft").onclick = () => turnRange(-15);
      document.getElementById("turnRight").onclick = () => turnRange(15);
      document.getElementById("startPlay").onclick = enterPlay;
      return;
    }

    if (state.phase === "play") {
      if (state.handoffTo != null) {
        const nxt = state.handoffTo;
        const done = state.names[nxt - 1] || "Last player";
        els.dock.innerHTML = `
          <div class="tiny">Round ${state.games.length + 1} of ${state.roundsPlanned} · ${state.placeName || "Spotter"}</div>
          <p style="margin:4px 0 10px">${done} is done. Hand the phone over, then start ${state.names[nxt]}.</p>
          <button class="btn wide" id="handoffBtn">Start ${state.names[nxt]}</button>
        `;
        document.getElementById("handoffBtn").onclick = () => {
          state.handoffTo = null;
          renderDock();
        };
        return;
      }
      const player = currentPlayer();
      const c = counts();
      const last = state.shots[state.shots.length - 1];
      const lastTxt = last ? (last.missed ? "missed" : fmt(last.toPin)) : "—";
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
              player == null ? "See score" : `${state.names[player]} · ${c[player] + 1} of ${state.shotsEach}`
            }</div>
          </div>
          <div style="text-align:right">
            <div class="tiny">Last to pin</div>
            <div class="big" style="font-size:18px">${lastTxt}</div>
          </div>
        </div>
        <div class="scoreline" style="margin-bottom:8px">${cards}</div>
        <div class="btn-row" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr">
          <button class="btn ghost" id="undoBtn" ${state.shots.length ? "" : "disabled"}>Undo</button>
          <button class="btn secondary" id="missBtn" ${player == null ? "disabled" : ""}>Missed</button>
          <button class="btn secondary" id="movePin">Pin</button>
          <button class="btn secondary" id="turnLeft">↺</button>
          <button class="btn secondary" id="turnRight">↻</button>
          <button class="btn danger" id="endBtn">End</button>
        </div>
      `;
      document.getElementById("undoBtn").onclick = undoShot;
      document.getElementById("missBtn").onclick = () => markShot(null, true);
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
  loadPrefs();
  renderGameSteps();
  setChip("Setup");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
