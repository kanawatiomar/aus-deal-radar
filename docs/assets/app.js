const dashboardConfig = window.DASHBOARD_CONFIG || {};
const endpoints = dashboardConfig.endpoints || {
  siteData: "/api/site-data",
  refresh: "/api/refresh",
};
const refreshEnabled = dashboardConfig.refreshEnabled !== false;
const pollMs = dashboardConfig.pollMs || 0;

const state = {
  mode: "both",
  bank: "all",
  region: "all",
  cabin: "all",
  focusAlertKey: null,
  userPinnedFocus: false,
};

const cache = {
  siteData: null,
  trackerFlights: [],
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

class FlightGlobe {
  constructor(canvas, onFocusChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onFocusChange = onFocusChange;
    this.routes = [];
    this.focusAlertKey = null;
    this.rotationY = -0.6;
    this.targetRotationY = -0.6;
    this.tilt = -0.35;
    this.targetTilt = -0.35;
    this.starfield = this.buildStars(180);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((time) => this.render(time));
  }

  buildStars(total) {
    return Array.from({ length: total }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: 0.35 + Math.random() * 1.8,
      alpha: 0.2 + Math.random() * 0.7,
    }));
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const bounds = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = bounds.width;
    this.height = bounds.height;
    this.centerX = bounds.width / 2;
    this.centerY = bounds.height / 2;
    this.radius = Math.min(bounds.width, bounds.height) * 0.31;
  }

  setFlights(flights, focusAlertKey) {
    this.routes = flights.map((flight, index) => ({
      ...flight,
      index,
      color: this.routeColor(flight),
      path: this.buildArc(flight),
      destinationPoint: this.latLonToVector(flight.destination_lat, flight.destination_lon),
    }));

    if (focusAlertKey) {
      this.focusOn(focusAlertKey, false);
    } else if (this.routes.length) {
      this.focusOn(this.routes[0].alert_key, false);
    }
  }

  focusOn(alertKey, triggerCallback = true) {
    const route = this.routes.find((item) => item.alert_key === alertKey);
    if (!route) {
      return;
    }
    this.focusAlertKey = route.alert_key;
    this.targetRotationY = -this.degToRad(route.destination_lon) + 0.95;
    const suggestedTilt = -0.22 - this.degToRad(route.destination_lat) * 0.35;
    this.targetTilt = Math.max(-1.0, Math.min(0.08, suggestedTilt));
    if (triggerCallback) {
      this.onFocusChange(route.alert_key);
    }
  }

  routeColor(flight) {
    if (flight.kind === "cash") {
      return flight.status === "delivered" ? "#6be6d9" : "#91f2a8";
    }
    return flight.status === "delivered" ? "#ffd278" : "#ff8f3f";
  }

  buildArc(flight) {
    const start = this.latLonToVector(flight.origin_lat, flight.origin_lon);
    const end = this.latLonToVector(flight.destination_lat, flight.destination_lon);
    const samples = 56;
    const arcHeight = 0.08 + flight.score / 320;
    const points = [];

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const base = this.slerp(start, end, t);
      const lift = 1 + Math.sin(Math.PI * t) * arcHeight;
      points.push({
        x: base.x * lift,
        y: base.y * lift,
        z: base.z * lift,
      });
    }
    return points;
  }

  latLonToVector(lat, lon) {
    const latRad = this.degToRad(lat);
    const lonRad = this.degToRad(lon);
    return {
      x: Math.cos(latRad) * Math.cos(lonRad),
      y: Math.sin(latRad),
      z: Math.cos(latRad) * Math.sin(lonRad),
    };
  }

  slerp(a, b, t) {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const omega = Math.acos(dot);
    if (!omega) {
      return a;
    }
    const sinOmega = Math.sin(omega);
    const aScale = Math.sin((1 - t) * omega) / sinOmega;
    const bScale = Math.sin(t * omega) / sinOmega;
    return {
      x: a.x * aScale + b.x * bScale,
      y: a.y * aScale + b.y * bScale,
      z: a.z * aScale + b.z * bScale,
    };
  }

  degToRad(value) {
    return (value * Math.PI) / 180;
  }

  rotate(point) {
    const cosY = Math.cos(this.rotationY);
    const sinY = Math.sin(this.rotationY);
    const x1 = point.x * cosY - point.z * sinY;
    const z1 = point.z * cosY + point.x * sinY;

    const cosX = Math.cos(this.tilt);
    const sinX = Math.sin(this.tilt);
    const y2 = point.y * cosX - z1 * sinX;
    const z2 = z1 * cosX + point.y * sinX;

    return { x: x1, y: y2, z: z2 };
  }

  project(point) {
    const rotated = this.rotate(point);
    const perspective = 2.55;
    const scale = perspective / (perspective - rotated.z);
    return {
      x: this.centerX + rotated.x * this.radius * scale,
      y: this.centerY - rotated.y * this.radius * scale,
      z: rotated.z,
      scale,
    };
  }

  render(timestamp) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.rotationY += (this.targetRotationY - this.rotationY) * 0.025;
    this.tilt += (this.targetTilt - this.tilt) * 0.03;

    this.drawStars(timestamp);
    this.drawAtmosphere();
    this.drawBackRoutes(timestamp);
    this.drawGlobe();
    this.drawGrid();
    this.drawFrontRoutes(timestamp);
    this.drawMarkers(timestamp);

    requestAnimationFrame((time) => this.render(time));
  }

  drawStars(timestamp) {
    for (const star of this.starfield) {
      const pulse = 0.75 + Math.sin(timestamp * 0.0005 + star.x * 10) * 0.25;
      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha * pulse})`;
      this.ctx.arc(star.x * this.width, star.y * this.height, star.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawAtmosphere() {
    const glow = this.ctx.createRadialGradient(
      this.centerX,
      this.centerY,
      this.radius * 0.84,
      this.centerX,
      this.centerY,
      this.radius * 1.34,
    );
    glow.addColorStop(0, "rgba(38, 94, 139, 0.00)");
    glow.addColorStop(0.65, "rgba(30, 103, 169, 0.14)");
    glow.addColorStop(1, "rgba(107, 230, 217, 0.12)");
    this.ctx.beginPath();
    this.ctx.fillStyle = glow;
    this.ctx.arc(this.centerX, this.centerY, this.radius * 1.36, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawGlobe() {
    const fill = this.ctx.createRadialGradient(
      this.centerX - this.radius * 0.24,
      this.centerY - this.radius * 0.3,
      this.radius * 0.18,
      this.centerX,
      this.centerY,
      this.radius,
    );
    fill.addColorStop(0, "rgba(38, 95, 141, 0.92)");
    fill.addColorStop(0.48, "rgba(11, 42, 72, 0.96)");
    fill.addColorStop(1, "rgba(4, 18, 33, 1)");
    this.ctx.beginPath();
    this.ctx.fillStyle = fill;
    this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawGrid() {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    this.ctx.clip();

    const latitudes = [-60, -30, 0, 30, 60];
    const longitudes = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

    for (const lat of latitudes) {
      this.drawWireLine(
        Array.from({ length: 80 }, (_, index) => {
          const lon = -180 + (index / 79) * 360;
          return this.latLonToVector(lat, lon);
        }),
        "rgba(107, 230, 217, 0.11)",
      );
    }

    for (const lon of longitudes) {
      this.drawWireLine(
        Array.from({ length: 80 }, (_, index) => {
          const lat = -90 + (index / 79) * 180;
          return this.latLonToVector(lat, lon);
        }),
        "rgba(255, 255, 255, 0.08)",
      );
    }

    this.ctx.restore();
  }

  drawWireLine(points, color) {
    let drawing = false;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (const point of points) {
      const projected = this.project(point);
      if (projected.z < -0.02) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        this.ctx.moveTo(projected.x, projected.y);
        drawing = true;
      } else {
        this.ctx.lineTo(projected.x, projected.y);
      }
    }
    this.ctx.stroke();
  }

  drawBackRoutes(timestamp) {
    this.drawRoutes(timestamp, false);
  }

  drawFrontRoutes(timestamp) {
    this.drawRoutes(timestamp, true);
  }

  drawRoutes(timestamp, frontOnly) {
    for (const route of this.routes) {
      const isFocused = route.alert_key === this.focusAlertKey;
      const lineWidth = isFocused ? 2.8 : 1.45;
      const alpha = frontOnly ? (isFocused ? 0.9 : 0.62) : 0.12;
      const projectedPath = route.path.map((point) => this.project(point));

      this.ctx.beginPath();
      let started = false;
      for (const projected of projectedPath) {
        const visible = frontOnly ? projected.z >= -0.02 : projected.z < -0.02;
        if (!visible) {
          started = false;
          continue;
        }
        if (!started) {
          this.ctx.moveTo(projected.x, projected.y);
          started = true;
        } else {
          this.ctx.lineTo(projected.x, projected.y);
        }
      }

      this.ctx.strokeStyle = this.hexToRgba(route.color, alpha);
      this.ctx.lineWidth = lineWidth;
      this.ctx.shadowBlur = frontOnly ? (isFocused ? 18 : 10) : 0;
      this.ctx.shadowColor = frontOnly ? this.hexToRgba(route.color, 0.24) : "transparent";
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;

      if (frontOnly) {
        const progress = ((timestamp * 0.00008 * (1.3 + route.index * 0.035)) + route.index * 0.13) % 1;
        const pulsePoint = projectedPath[Math.floor(progress * (projectedPath.length - 1))];
        if (pulsePoint && pulsePoint.z >= -0.02) {
          this.ctx.beginPath();
          this.ctx.fillStyle = this.hexToRgba(route.color, isFocused ? 0.95 : 0.72);
          this.ctx.arc(pulsePoint.x, pulsePoint.y, isFocused ? 4.5 : 3.2, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }
  }

  drawMarkers(timestamp) {
    for (const route of this.routes) {
      const projected = this.project(route.destinationPoint);
      if (projected.z < -0.02) {
        continue;
      }

      const isFocused = route.alert_key === this.focusAlertKey;
      const pulse = 1 + Math.sin(timestamp * 0.004 + route.index) * 0.12;
      this.ctx.beginPath();
      this.ctx.strokeStyle = this.hexToRgba(route.color, isFocused ? 0.8 : 0.35);
      this.ctx.lineWidth = isFocused ? 2 : 1.1;
      this.ctx.arc(projected.x, projected.y, (isFocused ? 10 : 7) * pulse, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.fillStyle = route.color;
      this.ctx.arc(projected.x, projected.y, isFocused ? 4 : 3, 0, Math.PI * 2);
      this.ctx.fill();
    }

    const aus = this.project(this.latLonToVector(30.1945, -97.6699));
    if (aus.z >= -0.02) {
      this.ctx.beginPath();
      this.ctx.fillStyle = "#ffffff";
      this.ctx.arc(aus.x, aus.y, 4.2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      this.ctx.lineWidth = 1.2;
      this.ctx.arc(aus.x, aus.y, 12, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const bigint = Number.parseInt(normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

const globe = new FlightGlobe(document.getElementById("alertGlobe"), (alertKey) => {
  state.focusAlertKey = alertKey;
  renderTrackerList(cache.trackerFlights);
  updateTrackerHud(cache.trackerFlights.find((item) => item.alert_key === alertKey));
});

function renderSnapshotMode() {
  if (refreshEnabled) {
    return;
  }
  const button = document.getElementById("refreshButton");
  button.disabled = true;
  button.textContent = "Snapshot Mode";
}

async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadSiteData() {
  cache.siteData = await fetchJSON(endpoints.siteData);
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  if (!cache.siteData) {
    return;
  }

  const filteredCash = cache.siteData.cash_deals.filter((item) => state.region === "all" || item.region === state.region);
  const filteredAwards = cache.siteData.award_deals.filter((item) => (
    (state.region === "all" || item.region === state.region)
    && (state.bank === "all" || item.banks.includes(state.bank))
    && (state.cabin === "all" || item.cabin === state.cabin)
  ));
  const filteredTracker = cache.siteData.tracker.flights.filter((item) => (
    (state.region === "all" || item.region === state.region)
    && (state.mode === "both" || item.kind === state.mode)
    && (item.kind === "cash" || state.bank === "all" || item.banks.includes(state.bank))
    && (item.kind === "cash" || state.cabin === "all" || item.cabin === state.cabin)
  ));

  cache.trackerFlights = filteredTracker;

  if (!state.focusAlertKey || !filteredTracker.some((item) => item.alert_key === state.focusAlertKey)) {
    state.focusAlertKey = filteredTracker[0]?.alert_key || null;
  }

  renderSummary(cache.siteData.summary);
  renderRadarBoard(buildRadarBoard(filteredCash, filteredAwards));
  renderCashTable(state.mode === "award" ? [] : filteredCash.slice(0, 18));
  renderAwardTable(state.mode === "cash" ? [] : filteredAwards.slice(0, 18));
  renderBonuses(cache.siteData.bonuses.slice(0, 8));
  renderTrackerMetrics(filteredTracker);
  renderTrackerList(filteredTracker);
  updateTrackerHud(filteredTracker.find((item) => item.alert_key === state.focusAlertKey));
  globe.setFlights(filteredTracker, state.focusAlertKey);
}

function buildRadarBoard(cashDeals, awardDeals) {
  const items = [];
  if (state.mode !== "award") {
    items.push(
      ...cashDeals.slice(0, 8).map((item) => ({
        kind: "cash",
        title: `${item.city} for $${Math.round(item.price)}`,
        subtitle: `${item.origin}->${item.destination} | ${item.band.toUpperCase()}`,
        score: item.score,
        detail: `${Math.round(item.anomaly_pct * 100)}% under baseline`,
      })),
    );
  }
  if (state.mode !== "cash") {
    items.push(
      ...awardDeals.slice(0, 8).map((item) => ({
        kind: "award",
        title: `${item.city} for ${item.points_cost.toLocaleString()} pts`,
        subtitle: `${item.program_display} | ${item.cabin} | ${item.band.toUpperCase()}`,
        score: item.score,
        detail: item.cpp ? `${item.cpp.toFixed(2)} cpp` : "cash match pending",
      })),
    );
  }
  return items.sort((a, b) => b.score - a.score).slice(0, 10);
}

function renderSummary(summary) {
  const root = document.getElementById("heroMetrics");
  const lastRefresh = summary.last_refresh ? new Date(summary.last_refresh).toLocaleString() : "Not yet";
  root.innerHTML = `
    <article><span>Cash Deals</span><strong>${summary.cash_count}</strong></article>
    <article><span>Award Deals</span><strong>${summary.award_count}</strong></article>
    <article><span>Bonus Hits</span><strong>${summary.bonus_count}</strong></article>
    <article><span>Last Sweep</span><strong>${lastRefresh}</strong></article>
  `;
}

function renderTrackerMetrics(items) {
  const root = document.getElementById("trackerMetrics");
  const cash = items.filter((item) => item.kind === "cash").length;
  const award = items.filter((item) => item.kind === "award").length;
  const live = items.filter((item) => item.status === "live").length;
  const delivered = items.filter((item) => item.status === "delivered").length;
  root.innerHTML = `
    <article><span>Active Alerts</span><strong>${items.length}</strong></article>
    <article><span>Live Arcs</span><strong>${live}</strong></article>
    <article><span>Delivered</span><strong>${delivered}</strong></article>
    <article><span>Cash / Award</span><strong>${cash} / ${award}</strong></article>
  `;
}

function renderTrackerList(items) {
  const root = document.getElementById("trackerList");
  if (!items.length) {
    root.innerHTML = `
      <article class="tracker-card">
        <header><strong>No alert routes right now</strong></header>
        <p>Run a fresh scan, update the snapshot, or loosen the filters to paint the globe.</p>
      </article>
    `;
    return;
  }

  root.innerHTML = items.map((item) => `
    <button class="tracker-card ${item.alert_key === state.focusAlertKey ? "active" : ""}" data-alert-key="${item.alert_key}" type="button">
      <header>
        <strong>${item.city}</strong>
        <span class="tracker-status ${item.status}">${item.status}</span>
      </header>
      <span class="tracker-route">${item.origin} -> ${item.destination}</span>
      <p>${item.title} | ${item.value_label}<br>${item.detail}</p>
      <div class="tracker-meta">
        <span>${item.departure_date}</span>
        <span>Signal ${Math.round(item.score)}</span>
      </div>
    </button>
  `).join("");

  root.querySelectorAll("[data-alert-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.focusAlertKey = button.dataset.alertKey;
      state.userPinnedFocus = true;
      globe.focusOn(state.focusAlertKey);
      renderTrackerList(cache.trackerFlights);
      updateTrackerHud(cache.trackerFlights.find((item) => item.alert_key === state.focusAlertKey));
    });
  });
}

function updateTrackerHud(flight) {
  const headline = document.getElementById("trackerHeadline");
  const subline = document.getElementById("trackerSubline");
  if (!flight) {
    headline.textContent = "No active alert trajectories";
    subline.textContent = "The globe is standing by for the next Austin deal burst.";
    return;
  }

  headline.textContent = `${flight.city} locked at ${flight.value_label}`;
  subline.textContent = `${flight.origin} to ${flight.destination} on ${flight.departure_date} | ${flight.detail} | ${flight.status === "delivered" ? "already pushed to Discord" : "ready to fire"}`;
}

function renderRadarBoard(items) {
  const root = document.getElementById("radarBoard");
  root.innerHTML = items.map((item) => `
    <article class="radar-card ${item.kind}">
      <span class="kind">${item.kind}</span>
      <strong>${item.title}</strong>
      <p>${item.subtitle}</p>
      <p>${item.detail}</p>
      <div class="score">Signal ${Math.round(item.score)}</div>
    </article>
  `).join("");
}

function renderCashTable(items) {
  const root = document.getElementById("cashTable");
  if (!items.length) {
    root.innerHTML = `<tr><td colspan="4">No cash matches for this filter.</td></tr>`;
    return;
  }
  root.innerHTML = items.map((item) => `
    <tr>
      <td><strong>${item.city}</strong><br><small>${item.origin} -> ${item.destination}</small></td>
      <td>${item.departure_date}${item.return_date ? `<br><small>Back ${item.return_date}</small>` : ""}</td>
      <td>${money.format(item.price)}</td>
      <td><span class="pill ${item.band}">${item.band}</span><br><small>${Math.round(item.anomaly_pct * 100)}% under baseline</small></td>
    </tr>
  `).join("");
}

function renderAwardTable(items) {
  const root = document.getElementById("awardTable");
  if (!items.length) {
    root.innerHTML = `<tr><td colspan="4">No award matches for this filter.</td></tr>`;
    return;
  }
  root.innerHTML = items.map((item) => `
    <tr>
      <td><strong>${item.city}</strong><br><small>${item.origin} -> ${item.destination} | ${item.cabin}</small></td>
      <td>${item.program_display}<br><small>${item.banks.join(", ")}</small></td>
      <td>${item.points_cost.toLocaleString()} pts${item.bonus_percent ? `<br><small>${item.bonus_percent}% bonus</small>` : ""}</td>
      <td><span class="pill ${item.band}">${item.band}</span><br><small>${item.cpp ? `${item.cpp.toFixed(2)} cpp` : "cash match pending"}</small></td>
    </tr>
  `).join("");
}

function renderBonuses(items) {
  const root = document.getElementById("bonusList");
  if (!items.length) {
    root.innerHTML = `<article class="bonus-card"><h3>No current bonus headlines</h3><p>The feed watcher did not surface any Amex or Capital One transfer bonus posts in the latest pass.</p></article>`;
    return;
  }
  root.innerHTML = items.map((item) => `
    <article class="bonus-card">
      <span class="bank">${item.bank.replace("_", " ")}</span>
      <h3>${item.bonus_percent}% to ${item.program_display}</h3>
      <p>${item.headline}</p>
      <a href="${item.url}" target="_blank" rel="noreferrer">Open source</a>
    </article>
  `).join("");
}

async function runRefresh() {
  if (!refreshEnabled) {
    return;
  }
  const button = document.getElementById("refreshButton");
  button.disabled = true;
  button.textContent = "Scanning...";
  try {
    await fetch(endpoints.refresh, { method: "POST" });
    state.userPinnedFocus = false;
    await loadSiteData();
  } finally {
    button.disabled = false;
    button.textContent = "Run Fresh Scan";
  }
}

function applyFilter(key, value) {
  state[key] = value;
  state.userPinnedFocus = false;
  applyFiltersAndRender();
}

function wireFilters() {
  document.getElementById("modeFilter").addEventListener("change", (event) => applyFilter("mode", event.target.value));
  document.getElementById("bankFilter").addEventListener("change", (event) => applyFilter("bank", event.target.value));
  document.getElementById("regionFilter").addEventListener("change", (event) => applyFilter("region", event.target.value));
  document.getElementById("cabinFilter").addEventListener("change", (event) => applyFilter("cabin", event.target.value));
  document.getElementById("refreshButton").addEventListener("click", runRefresh);
}

function startAutoCycle() {
  window.setInterval(() => {
    if (state.userPinnedFocus || cache.trackerFlights.length < 2) {
      return;
    }
    const currentIndex = cache.trackerFlights.findIndex((item) => item.alert_key === state.focusAlertKey);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cache.trackerFlights.length : 0;
    state.focusAlertKey = cache.trackerFlights[nextIndex].alert_key;
    globe.focusOn(state.focusAlertKey);
    renderTrackerList(cache.trackerFlights);
    updateTrackerHud(cache.trackerFlights[nextIndex]);
  }, 7000);

  if (pollMs > 0) {
    window.setInterval(() => {
      loadSiteData().catch((error) => console.error(error));
    }, pollMs);
  }
}

renderSnapshotMode();
wireFilters();
startAutoCycle();
loadSiteData().catch((error) => console.error(error));
