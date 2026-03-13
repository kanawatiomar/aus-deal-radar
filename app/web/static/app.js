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
const trackerElements = {
  canvas: document.getElementById("alertGlobe"),
  metrics: document.getElementById("trackerMetrics"),
  list: document.getElementById("trackerList"),
  headline: document.getElementById("trackerHeadline"),
  subline: document.getElementById("trackerSubline"),
};
const trackerEnabled = Boolean(
  trackerElements.canvas
  && trackerElements.metrics
  && trackerElements.list
  && trackerElements.headline
  && trackerElements.subline,
);

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const CONTINENT_POLYGONS = [
  [[-168, 72], [-155, 60], [-145, 58], [-134, 55], [-126, 50], [-124, 43], [-120, 35], [-116, 30], [-111, 24], [-104, 20], [-96, 18], [-89, 19], [-84, 24], [-80, 29], [-77, 38], [-71, 45], [-63, 49], [-58, 55], [-61, 61], [-72, 68], [-92, 74], [-120, 77], [-147, 76]],
  [[-82, 12], [-77, 7], [-74, -2], [-76, -13], [-74, -22], [-71, -31], [-67, -40], [-62, -52], [-55, -54], [-48, -44], [-43, -32], [-39, -18], [-43, -7], [-47, 1], [-55, 7], [-66, 10]],
  [[-54, 59], [-42, 61], [-30, 69], [-24, 77], [-33, 83], [-48, 82], [-58, 75], [-61, 67]],
  [[-12, 35], [-4, 43], [8, 48], [22, 52], [40, 56], [58, 58], [76, 57], [94, 56], [114, 52], [132, 50], [148, 55], [166, 60], [176, 68], [160, 72], [132, 70], [98, 73], [66, 74], [40, 68], [26, 61], [18, 55], [6, 54], [-7, 51], [-18, 57], [-28, 63], [-18, 50], [-12, 41]],
  [[-17, 37], [-5, 34], [10, 35], [23, 32], [34, 26], [41, 13], [51, 10], [49, 2], [43, -11], [40, -20], [33, -30], [23, -35], [12, -34], [2, -27], [-4, -15], [-8, -2], [-13, 12], [-15, 24]],
  [[111, -11], [114, -22], [121, -33], [132, -38], [145, -37], [153, -28], [151, -17], [143, -11], [132, -11], [121, -14]],
  [[48, -13], [50, -17], [48, -22], [45, -25], [43, -20], [45, -15]],
  [[140, 35], [144, 42], [146, 45], [141, 46], [137, 42], [136, 37]],
  [[95, 7], [104, 16], [115, 20], [123, 15], [120, 6], [112, 0], [103, 1]],
];

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

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
    this.starfield = this.buildStars(240);
    this.landPoints = this.buildLandPoints();
    this.coastPoints = this.buildCoastPoints();
    this.cloudPoints = this.buildCloudPoints();
    this.cityLights = this.buildCityLights();
    this.lightVector = normalizeVector({ x: -0.62, y: 0.28, z: 0.74 });
    this.cloudDrift = 0;
    this.lastTimestamp = 0;
    this.dragging = false;
    this.pointerId = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.resize();
    this.bindPointerEvents();
    this.canvas.style.cursor = "grab";
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((time) => this.render(time));
  }

  buildStars(total) {
    return Array.from({ length: total }, () => ({
      x: Math.random(),
      y: Math.random(),
      depth: 0.3 + Math.random() * 0.9,
      radius: 0.25 + Math.random() * 1.9,
      alpha: 0.18 + Math.random() * 0.8,
    }));
  }

  buildLandPoints() {
    const points = [];
    for (let lat = -56; lat <= 82; lat += 2.15) {
      for (let lon = -180; lon <= 180; lon += 2.15) {
        if (!this.isLand(lon, lat)) {
          continue;
        }
        const noiseA = Math.sin((lon + 30) * 0.065) + Math.cos((lat - 4) * 0.18);
        const noiseB = Math.sin((lon - lat) * 0.115) + Math.cos((lon + lat) * 0.035);
        const elevation = (noiseA * 0.42 + noiseB * 0.3 + 1.7) / 2.42;
        const moisture = (Math.cos((lon - 20) * 0.055) + Math.sin(lat * 0.19) + 1.8) / 2.8;
        points.push({
          vector: this.latLonToVector(
            lat + Math.cos((lon - lat) * 0.12) * 0.38,
            lon + Math.sin((lon + lat) * 0.07) * 0.42,
          ),
          elevation,
          moisture,
          size: 0.8 + Math.max(0, elevation) * 1.2,
        });
      }
    }
    return points;
  }

  buildCoastPoints() {
    const points = [];
    for (const polygon of CONTINENT_POLYGONS) {
      for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        const distance = Math.hypot(next[0] - current[0], next[1] - current[1]);
        const steps = Math.max(3, Math.ceil(distance / 3));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const lon = current[0] + (next[0] - current[0]) * t;
          const lat = current[1] + (next[1] - current[1]) * t;
          points.push({
            vector: this.latLonToVector(lat, lon),
            size: 1.25 + Math.sin((lon + lat) * 0.3) * 0.25,
          });
        }
      }
    }
    return points;
  }

  buildCloudPoints() {
    const points = [];
    for (let lat = -66; lat <= 74; lat += 2.8) {
      for (let lon = -180; lon <= 180; lon += 3.4) {
        const density =
          Math.sin((lon + 60) * 0.075)
          + Math.cos((lat - 8) * 0.22)
          + Math.sin((lon - lat) * 0.09)
          + Math.cos((lon * 0.028) + (lat * 0.11));
        if (density < 1.55) {
          continue;
        }
        points.push({
          lat,
          lon,
          size: 1.1 + ((density - 1.55) * 1.8),
          alpha: 0.18 + ((density - 1.55) * 0.12),
        });
      }
    }
    return points;
  }

  buildCityLights() {
    const points = [];
    for (let lat = -48; lat <= 64; lat += 2.55) {
      for (let lon = -180; lon <= 180; lon += 2.55) {
        if (!this.isLand(lon, lat)) {
          continue;
        }
        const urbanity =
          Math.sin((lon + 24) * 0.12)
          + Math.cos((lat - 7) * 0.22)
          + Math.sin((lon - lat) * 0.085);
        const temperateBand = 1 - Math.min(1, Math.abs(lat) / 78);
        const density = urbanity + (temperateBand * 1.05);
        if (density < 1.45) {
          continue;
        }
        points.push({
          vector: this.latLonToVector(
            lat + Math.sin((lon + lat) * 0.17) * 0.22,
            lon + Math.cos((lon - lat) * 0.13) * 0.22,
          ),
          size: 0.7 + ((density - 1.45) * 1.2),
          alpha: 0.12 + ((density - 1.45) * 0.1),
        });
      }
    }
    return points;
  }

  bindPointerEvents() {
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.pointerId = event.pointerId;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.canvas.style.cursor = "grabbing";
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging || event.pointerId !== this.pointerId) {
        return;
      }
      const dx = event.clientX - this.dragStartX;
      const dy = event.clientY - this.dragStartY;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.targetRotationY += dx * 0.0062;
      this.targetTilt = Math.max(-1.05, Math.min(0.18, this.targetTilt + dy * 0.0035));
      state.userPinnedFocus = true;
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (event.pointerId !== this.pointerId) {
        return;
      }
      this.dragging = false;
      this.canvas.style.cursor = "grab";
      this.canvas.releasePointerCapture(event.pointerId);
      this.pointerId = null;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
      this.pointerId = null;
      this.canvas.style.cursor = "grab";
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.dragging = false;
      this.pointerId = null;
      this.canvas.style.cursor = "grab";
    });
  }

  isLand(lon, lat) {
    return CONTINENT_POLYGONS.some((polygon) => this.pointInPolygon(lon, lat, polygon));
  }

  pointInPolygon(lon, lat, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      const intersects = ((yi > lat) !== (yj > lat))
        && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 0.00001) + xi);
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
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
    this.radius = Math.min(bounds.width, bounds.height) * 0.355;
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

    const dt = this.lastTimestamp ? Math.min(40, timestamp - this.lastTimestamp) : 16;
    this.lastTimestamp = timestamp;
    this.rotationY += (this.targetRotationY - this.rotationY) * 0.025;
    this.tilt += (this.targetTilt - this.tilt) * 0.03;
    this.cloudDrift += dt * 0.0016;

    this.drawDeepSpace(timestamp);
    this.drawStars(timestamp);
    this.drawAtmosphere();
    this.drawGlobe();
    this.drawNightMask();
    this.drawSurface();
    this.drawBackRoutes(timestamp);
    this.drawFrontRoutes(timestamp);
    this.drawMarkers(timestamp);
    this.drawRimLight();

    requestAnimationFrame((time) => this.render(time));
  }

  drawDeepSpace(timestamp) {
    const haze = this.ctx.createRadialGradient(
      this.width * 0.18,
      this.height * 0.1,
      20,
      this.width * 0.18,
      this.height * 0.1,
      this.width * 0.8,
    );
    haze.addColorStop(0, "rgba(61, 126, 188, 0.16)");
    haze.addColorStop(0.42, "rgba(14, 36, 61, 0.08)");
    haze.addColorStop(1, "rgba(3, 7, 12, 0)");
    this.ctx.fillStyle = haze;
    this.ctx.fillRect(0, 0, this.width, this.height);

    const ember = this.ctx.createRadialGradient(
      this.width * 0.84,
      this.height * 0.16,
      12,
      this.width * 0.84,
      this.height * 0.16,
      this.width * 0.35,
    );
    ember.addColorStop(0, "rgba(255, 154, 78, 0.16)");
    ember.addColorStop(0.4, "rgba(255, 154, 78, 0.04)");
    ember.addColorStop(1, "rgba(255, 154, 78, 0)");
    this.ctx.fillStyle = ember;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.beginPath();
    this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + Math.sin(timestamp * 0.00028) * 0.02})`;
    this.ctx.lineWidth = 1;
    this.ctx.arc(this.centerX, this.centerY + this.radius * 0.04, this.radius * 1.28, Math.PI * 1.12, Math.PI * 1.88);
    this.ctx.stroke();
  }

  drawStars(timestamp) {
    for (const star of this.starfield) {
      const driftX = Math.sin((timestamp * 0.00006) + (star.y * 8)) * star.depth * 6;
      const driftY = Math.cos((timestamp * 0.00004) + (star.x * 9)) * star.depth * 4;
      const pulse = 0.72 + Math.sin(timestamp * 0.0005 + star.x * 10) * 0.28;
      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha * pulse})`;
      this.ctx.arc((star.x * this.width) + driftX, (star.y * this.height) + driftY, star.radius, 0, Math.PI * 2);
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
    glow.addColorStop(0.55, "rgba(41, 118, 178, 0.18)");
    glow.addColorStop(0.86, "rgba(107, 230, 217, 0.18)");
    glow.addColorStop(1, "rgba(107, 230, 217, 0.05)");
    this.ctx.beginPath();
    this.ctx.fillStyle = glow;
    this.ctx.arc(this.centerX, this.centerY, this.radius * 1.42, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawGlobe() {
    const lightX = this.centerX + (this.lightVector.x * this.radius * 0.45);
    const lightY = this.centerY - (this.lightVector.y * this.radius * 0.35);
    const fill = this.ctx.createRadialGradient(
      lightX,
      lightY,
      this.radius * 0.08,
      this.centerX,
      this.centerY,
      this.radius,
    );
    fill.addColorStop(0, "rgba(94, 168, 232, 0.92)");
    fill.addColorStop(0.18, "rgba(35, 91, 148, 0.96)");
    fill.addColorStop(0.55, "rgba(10, 44, 77, 0.98)");
    fill.addColorStop(1, "rgba(3, 17, 31, 1)");
    this.ctx.beginPath();
    this.ctx.fillStyle = fill;
    this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    this.ctx.fill();

    const oceanHighlight = this.ctx.createRadialGradient(
      lightX,
      lightY,
      this.radius * 0.02,
      lightX,
      lightY,
      this.radius * 0.72,
    );
    oceanHighlight.addColorStop(0, "rgba(182, 223, 255, 0.34)");
    oceanHighlight.addColorStop(0.42, "rgba(108, 181, 232, 0.13)");
    oceanHighlight.addColorStop(1, "rgba(108, 181, 232, 0)");
    this.ctx.beginPath();
    this.ctx.fillStyle = oceanHighlight;
    this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawNightMask() {
    const shadowX = this.centerX - (this.lightVector.x * this.radius * 0.52);
    const shadowY = this.centerY + (this.lightVector.y * this.radius * 0.5);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    this.ctx.clip();
    const shadow = this.ctx.createRadialGradient(
      shadowX,
      shadowY,
      this.radius * 0.12,
      shadowX,
      shadowY,
      this.radius * 0.95,
    );
    shadow.addColorStop(0, "rgba(1, 8, 16, 0)");
    shadow.addColorStop(0.48, "rgba(1, 8, 16, 0.24)");
    shadow.addColorStop(1, "rgba(1, 6, 12, 0.78)");
    this.ctx.fillStyle = shadow;
    this.ctx.fillRect(
      this.centerX - this.radius,
      this.centerY - this.radius,
      this.radius * 2,
      this.radius * 2,
    );
    this.ctx.restore();
  }

  drawSurface() {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    this.ctx.clip();
    this.drawOceanBands();
    this.drawLandMasses();
    this.drawCityLights();
    this.drawCloudLayer();
    this.drawGrid();
    this.ctx.restore();
  }

  drawOceanBands() {
    this.ctx.strokeStyle = "rgba(115, 185, 235, 0.07)";
    this.ctx.lineWidth = 1.4;
    for (let index = 0; index < 4; index += 1) {
      const offset = (index * 0.18) - 0.28;
      this.ctx.beginPath();
      this.ctx.ellipse(
        this.centerX + (offset * this.radius * 0.42),
        this.centerY + ((index - 1.5) * this.radius * 0.1),
        this.radius * (0.8 - index * 0.07),
        this.radius * (0.22 + index * 0.03),
        index * 0.22,
        0,
        Math.PI * 2,
      );
      this.ctx.stroke();
    }
  }

  drawLandMasses() {
    const litPoints = [];
    const coastPoints = [];

    for (const point of this.landPoints) {
      const projected = this.project(point.vector);
      if (projected.z < -0.03) {
        continue;
      }
      const brightness = this.surfaceBrightness(projected);
      litPoints.push({ projected, point, brightness });
    }

    litPoints.sort((a, b) => a.projected.z - b.projected.z);
    for (const entry of litPoints) {
      const color = this.landColor(entry.point, entry.brightness);
      this.ctx.beginPath();
      this.ctx.fillStyle = color;
      this.ctx.arc(
        entry.projected.x,
        entry.projected.y,
        Math.max(0.6, entry.point.size * entry.projected.scale * 0.82),
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    }

    for (const point of this.coastPoints) {
      const projected = this.project(point.vector);
      if (projected.z < -0.02) {
        continue;
      }
      const brightness = this.surfaceBrightness(projected);
      if (brightness <= 0.06) {
        continue;
      }
      coastPoints.push({ projected, point, brightness });
    }

    for (const entry of coastPoints) {
      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(169, 238, 209, ${0.12 + entry.brightness * 0.22})`;
      this.ctx.arc(
        entry.projected.x,
        entry.projected.y,
        Math.max(0.8, entry.point.size * entry.projected.scale * 0.68),
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    }
  }

  drawCloudLayer() {
    for (const point of this.cloudPoints) {
      const vector = this.latLonToVector(point.lat, point.lon + this.cloudDrift);
      const projected = this.project({
        x: vector.x * 1.025,
        y: vector.y * 1.025,
        z: vector.z * 1.025,
      });
      if (projected.z < -0.03) {
        continue;
      }
      const brightness = Math.max(0.14, this.surfaceBrightness(projected));
      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(235, 245, 255, ${point.alpha * brightness})`;
      this.ctx.ellipse(
        projected.x,
        projected.y,
        Math.max(1.2, point.size * projected.scale * 1.9),
        Math.max(0.6, point.size * projected.scale * 0.85),
        0,
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    }
  }

  drawCityLights() {
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    for (const point of this.cityLights) {
      const projected = this.project(point.vector);
      if (projected.z < -0.01) {
        continue;
      }
      const brightness = this.surfaceBrightness(projected);
      const darkness = 1 - Math.min(1, brightness * 2.2);
      if (darkness < 0.28) {
        continue;
      }
      const radius = Math.max(0.65, point.size * projected.scale * 0.9);
      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(255, 195, 104, ${(point.alpha + 0.08) * darkness})`;
      this.ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      if (darkness > 0.6) {
        this.ctx.beginPath();
        this.ctx.fillStyle = `rgba(255, 132, 54, ${point.alpha * 0.35 * darkness})`;
        this.ctx.arc(projected.x, projected.y, radius * 1.85, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
    this.ctx.restore();
  }

  drawGrid() {
    const latitudes = [-60, -30, 0, 30, 60];
    const longitudes = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

    for (const lat of latitudes) {
      this.drawWireLine(
        Array.from({ length: 80 }, (_, index) => {
          const lon = -180 + (index / 79) * 360;
          return this.latLonToVector(lat, lon);
        }),
        "rgba(122, 194, 241, 0.08)",
      );
    }

    for (const lon of longitudes) {
      this.drawWireLine(
        Array.from({ length: 80 }, (_, index) => {
          const lat = -90 + (index / 79) * 180;
          return this.latLonToVector(lat, lon);
        }),
        "rgba(255, 255, 255, 0.05)",
      );
    }
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
      this.ctx.shadowBlur = frontOnly ? (isFocused ? 22 : 12) : 0;
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
      this.ctx.strokeStyle = this.hexToRgba(route.color, isFocused ? 0.84 : 0.28);
      this.ctx.lineWidth = isFocused ? 2 : 1.1;
      this.ctx.arc(projected.x, projected.y, (isFocused ? 12 : 8) * pulse, 0, Math.PI * 2);
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
      this.ctx.arc(aus.x, aus.y, 14, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  drawRimLight() {
    this.ctx.beginPath();
    this.ctx.strokeStyle = "rgba(157, 224, 255, 0.22)";
    this.ctx.lineWidth = 2.2;
    this.ctx.arc(this.centerX, this.centerY, this.radius + 1.5, Math.PI * 0.1, Math.PI * 1.62);
    this.ctx.stroke();
  }

  surfaceBrightness(projected) {
    return Math.max(
      0,
      (projected.x - this.centerX) / this.radius * this.lightVector.x
      + (this.centerY - projected.y) / this.radius * this.lightVector.y
      + projected.z * this.lightVector.z,
    );
  }

  landColor(point, brightness) {
    const light = 0.18 + (brightness * 0.84);
    let r;
    let g;
    let b;

    if (point.elevation > 0.82) {
      r = 182;
      g = 169;
      b = 133;
    } else if (point.elevation > 0.62) {
      r = 96;
      g = 126 + (point.moisture * 18);
      b = 92;
    } else {
      r = 54 + (point.moisture * 18);
      g = 94 + (point.moisture * 34);
      b = 65 + (point.moisture * 16);
    }

    return `rgba(${Math.round(r * light)}, ${Math.round(g * light)}, ${Math.round(b * light)}, ${0.45 + brightness * 0.44})`;
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

const globe = trackerEnabled
  ? new FlightGlobe(trackerElements.canvas, (alertKey) => {
    state.focusAlertKey = alertKey;
    renderTrackerList(cache.trackerFlights);
    updateTrackerHud(cache.trackerFlights.find((item) => item.alert_key === alertKey));
  })
  : null;

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
  if (trackerEnabled && globe) {
    renderTrackerMetrics(filteredTracker);
    renderTrackerList(filteredTracker);
    updateTrackerHud(filteredTracker.find((item) => item.alert_key === state.focusAlertKey));
    globe.setFlights(filteredTracker, state.focusAlertKey);
  }
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
  const root = trackerElements.metrics;
  if (!root) {
    return;
  }
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
  const root = trackerElements.list;
  if (!root) {
    return;
  }
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
      globe?.focusOn(state.focusAlertKey);
      renderTrackerList(cache.trackerFlights);
      updateTrackerHud(cache.trackerFlights.find((item) => item.alert_key === state.focusAlertKey));
    });
  });
}

function updateTrackerHud(flight) {
  const headline = trackerElements.headline;
  const subline = trackerElements.subline;
  if (!headline || !subline) {
    return;
  }
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
  if (trackerEnabled && globe) {
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
  }

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
