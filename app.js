(() => {
  const VERSION = "0.5.10";
  const YARDS_PER_METER = 1.0936133;
  const STORE = "spotter-v041";
  const COLORS = ["#5ec8ff", "#e6c36a", "#d08cff", "#7ed38a"];

  const GAME_CATALOG = {
    closest: {
      id: "closest",
      label: "Closest to the Pin",
      steps: [
        ["First", "select the number of players."],
        ["Second", "select how many balls each player gets."],
        ["Third", "open the range, mark TEE (where you stand), then PIN (the target)."],
        ["Fourth", "update player names as needed."]
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
    tee: null,
    pin: null,
    shots: [],
    lastYards: null,
    mapReady: false,
    games: [],
    sessionYards: {},
    gpsNote: ""
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

  let map, teeMarker, pinMarker, shotLayer, ringLayer;

  function playerN() {
    return state.names.length;
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.count) els.playerCount.value = String(p.count);
      ["name1", "name2", "name3", "name4", "shots", "gameType"].forEach((id) => {
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
      if (p.savedTee && p.savedPin) return { tee: p.savedTee, pin: p.savedPin };
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
      attributionControl: true
    }).setView(INDIAN_TREE.center, INDIAN_TREE.zoom);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles © Esri" }
    ).addTo(map);

    shotLayer = L.layerGroup().addTo(map);
    ringLayer = L.layerGroup().addTo(map);
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

  function placeTee(latlng, skipDock) {
    state.tee = latlng;
    if (teeMarker) map.removeLayer(teeMarker);
    teeMarker = L.marker(latlng, { icon: divIcon("tee"), draggable: true, zIndexOffset: 600 })
      .bindTooltip("Tee · drag to your bay", { permanent: true, direction: "top", offset: [0, -10] })
      .addTo(map);
    teeMarker.on("dragend", () => {
      const p = teeMarker.getLatLng();
      state.tee = [p.lat, p.lng];
      saveGeom();
      renderDock();
    });
    if (!skipDock) renderDock();
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
    if (state.phase === "calibrate") {
      placeTee(latlng);
      return;
    }
    if (state.phase === "pin") {
      placePin(latlng);
      return;
    }
    if (state.phase === "play") markShot(latlng, false);
  }

  function markShot(latlng, missed) {
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
    if (currentPlayer() == null) finishGame();
    else renderDock();
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
    state.games.push({
      at: Date.now(),
      names: state.names.slice(),
      winners: result.names,
      bests: result.bests,
      avgWinners: avg.names,
      avgs: avg.avgs,
      shotCount: state.shots.length
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
      <div class="tiny">Closest to the pin · v${VERSION} · game ${state.games.length}</div>
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
      <button class="btn wide" id="replayBtn">Play another game</button>
      <div style="height:8px"></div>
      <button class="btn secondary wide" id="endSessionBtn">End session</button>
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
      <div class="tiny">Session recap · v${VERSION} · ${selectedGame().label}</div>
      <div class="winner">
        <div class="tiny">${state.games.length} game${state.games.length === 1 ? "" : "s"}${ties ? ` · ${ties} tie${ties === 1 ? "" : "s"}` : ""}</div>
        <h2 style="margin:4px 0 6px">${line}</h2>
        <p class="lede" style="margin:0 0 8px">${scoreLine || "No wins recorded."}</p>
        <p class="lede" style="margin:0 0 10px">${avgHonor}</p>
        <div class="row">${cards}</div>
      </div>
      <div class="tiny">All games this visit</div>
      <div class="list">${gamesHtml || "<p class='lede'>No games recorded.</p>"}</div>
      <button class="btn wide" id="homeBtn">Back to setup</button>
    `;
    els.score.classList.remove("hidden");
    document.getElementById("homeBtn").onclick = resetToSetup;
  }

  function replaySame() {
    state.shots = [];
    state.lastYards = null;
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
    placeTee(INDIAN_TREE.bays.right, true);
    placePin(INDIAN_TREE.pins[150], true);
    map.fitBounds(L.latLngBounds([INDIAN_TREE.bays.right, INDIAN_TREE.pins[150]]).pad(0.55));
    saveGeom();
    state.gpsNote =
      reason ||
      "Spotter Range is on the map as a stand-in layout. Drag Tee and Pin, or play it as-is.";
    document.getElementById("siteLabel").textContent = "Spotter Range";
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
        map.setView(latlng, 19);
        placeTee(latlng);
        saveGeom();
        document.getElementById("siteLabel").textContent = "Your GPS · tap the pin next";
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
    const gameEl = document.getElementById("gameType");
    state.game = gameEl && gameEl.value ? gameEl.value : "closest";
    state.shots = [];
    state.lastYards = null;
    state.gpsNote = "";
    const useSaved = document.getElementById("useSavedBay").checked;
    const saved = readSavedGeom();

    els.setup.classList.add("hidden");
    initMap();

    if (useSaved && saved) {
      placeTee(saved.tee, true);
      placePin(saved.pin, true);
      enterPlay();
      return;
    }

    state.phase = "calibrate";
    setChip("Tee");
    map.setView(INDIAN_TREE.center, 17);
    renderDock();
    useGpsForTee();
  }

  function enterPlay() {
    if (!state.tee || !state.pin) return;
    state.phase = "play";
    setChip("Play");
    saveGeom();
    renderDock();
    map.fitBounds(L.latLngBounds([state.tee, state.pin]).pad(0.6));
    setTimeout(() => map.invalidateSize(), 60);
  }

  function renderDock() {
    if (state.phase === "setup" || state.phase === "score") {
      els.dock.innerHTML = "";
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
        <div class="btn-row">
          <button class="btn secondary" id="backCal">Back</button>
          <button class="btn" id="startPlay" ${state.pin ? "" : "disabled"}>Start game</button>
        </div>
      `;
      document.getElementById("backCal").onclick = () => {
        state.phase = "calibrate";
        setChip("Calibrate");
        renderDock();
      };
      document.getElementById("startPlay").onclick = enterPlay;
      return;
    }

    if (state.phase === "play") {
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
                : c[player] === 0 && player > 0
                  ? `Hand the phone — ${state.names[player]} hits all ${state.shotsEach}`
                  : `${state.names[player]} hits their ${state.shotsEach}, then you switch`
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
        <div class="btn-row" style="grid-template-columns:1fr 1fr 1fr 1fr">
          <button class="btn ghost" id="undoBtn" ${state.shots.length ? "" : "disabled"}>Undo</button>
          <button class="btn secondary" id="missBtn" ${player == null ? "disabled" : ""}>Missed</button>
          <button class="btn secondary" id="movePin">Pin</button>
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
