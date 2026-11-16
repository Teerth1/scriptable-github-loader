// Variables used by Scriptable.
// icon-color: blue; icon-glyph: bus;

// ATLAS shuttle tracker. Run setup-bus.js on your device before using this widget.
// No endpoint or API credentials are stored in this file.
const FORCE_ONLINE = false; // Testing only: bypass the service-hours display.
const SETTINGS_KEY = "atlas-shuttle-connection";
const SERVICE_TIME_ZONE = "America/New_York";
const STALE_AFTER_MINUTES = 10;

// Monday–Friday departures from Atlas. Verify the current timetable with the operator.
const SCHEDULED_TIMES = [
  "7:15 AM", "8:00 AM", "8:45 AM", "9:30 AM", "10:15 AM", "11:00 AM",
  "11:45 AM", "12:30 PM", "1:30 PM", "2:15 PM", "3:00 PM", "3:45 PM",
  "4:30 PM", "5:15 PM", "6:00 PM"
];

// Geofence radii are in miles. Stops follow the original route order.
const ROUTE_STOPS = [
  { abbr: "ATL", lat: 33.943026, lon: -83.338263, radius: 0.10 },
  { abbr: "MAIN", lat: 33.954941, lon: -83.373093, radius: 0.05 },
  { abbr: "JOUR", lat: 33.951909, lon: -83.373336, radius: 0.05 },
  { abbr: "TATE", lat: 33.950908, lon: -83.374164, radius: 0.05 },
  { abbr: "BOYD", lat: 33.946293, lon: -83.376286, radius: 0.05 },
  { abbr: "COL", lat: 33.942599, lon: -83.376988, radius: 0.05 },
  { abbr: "ADER", lat: 33.941406, lon: -83.373222, radius: 0.05 },
  { abbr: "JOE", lat: 33.939599, lon: -83.370638, radius: 0.05 }
];

function readConnection() {
  if (!Keychain.contains(SETTINGS_KEY)) return null;
  try {
    const settings = JSON.parse(Keychain.get(SETTINGS_KEY));
    return settings.url && settings.key ? settings : null;
  } catch (_) {
    return null;
  }
}

async function fetchShuttleData(connection) {
  const req = new Request(connection.url);
  req.headers = { Accept: "application/json", apikey: connection.key };
  // Modern publishable keys belong in apikey, not a Bearer JWT header.
  if (connection.key.startsWith("eyJ")) {
    req.headers.Authorization = "Bearer " + connection.key;
  }
  req.timeoutInterval = 10;
  try {
    const data = await req.loadJSON();
    const status = req.response && req.response.statusCode;
    if (!status || status < 200 || status >= 300) return null;
    return parseCoordinates(data);
  } catch (_) {
    // Avoid logging connection URLs, response bodies, or credentials.
    console.warn("[Bus] Unable to fetch location. Check connection settings and network.");
    return null;
  }
}

function parseCoordinates(data) {
  const record = Array.isArray(data) ? data[0] : data;
  if (!record || typeof record !== "object") return null;
  const lat = record.latitude ?? record.lat ?? record.location?.latitude;
  const lon = record.longitude ?? record.lng ?? record.lon ?? record.location?.longitude;
  if (lat == null || lon == null || String(lat).trim() === "" || String(lon).trim() === "") return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const speed = Number(record.speed_mph ?? 0);
  const timestamp = record.recorded_at ? Date.parse(record.recorded_at) : NaN;
  return {
    latitude, longitude,
    speed: Number.isFinite(speed) && speed >= 0 ? speed : 0,
    recordedAt: Number.isFinite(timestamp) ? timestamp : null,
  };
}

function serviceClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SERVICE_TIME_ZONE, weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return { weekday: value("weekday"), minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

function isBusOffline(now = new Date()) {
  if (FORCE_ONLINE) return false;
  const clock = serviceClock(now);
  return ["Sat", "Sun"].includes(clock.weekday) || clock.minutes < 405 || clock.minutes >= 1140;
}

function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
  const toRad = degrees => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}

function calculateETAInMinutes(distanceMiles, speedMph) {
  if (distanceMiles < 0.05) return 0;
  return Math.max(1, Math.round(distanceMiles / (speedMph > 0 ? speedMph : 5) * 60));
}

function getNextScheduledTimes(now = new Date()) {
  const clock = serviceClock(now);
  if (["Sat", "Sun"].includes(clock.weekday)) return ["Weekdays only"];
  const upcoming = SCHEDULED_TIMES.filter(timeString => {
    const [time, modifier] = timeString.split(" ");
    const [hours, minutes] = time.split(":").map(Number);
    return (hours % 12 + (modifier === "PM" ? 12 : 0)) * 60 + minutes >= clock.minutes;
  }).slice(0, 3);
  return upcoming.length ? upcoming : ["Done for today"];
}

function getBusState(busLat, busLng) {
  const distances = ROUTE_STOPS.map((stop, index) => ({
    index, dist: calculateDistanceInMiles(busLat, busLng, stop.lat, stop.lon),
  })).sort((a, b) => a.dist - b.dist);
  const closest = distances[0];
  const nextIndex = (closest.index + 1) % ROUTE_STOPS.length;
  return {
    isAtStop: closest.dist < ROUTE_STOPS[closest.index].radius,
    currentStop: ROUTE_STOPS[closest.index], nextStop: ROUTE_STOPS[nextIndex],
    closestIndex: closest.index, nextIndex,
  };
}

function generateRouteVisual(busState) {
  const visual = [];
  const wrapping = busState.closestIndex === ROUTE_STOPS.length - 1;
  if (wrapping && !busState.isAtStop) visual.push("🚌 > ");
  for (let i = 0; i < ROUTE_STOPS.length; i++) {
    visual.push(busState.isAtStop && i === busState.closestIndex ? "🚌" : ROUTE_STOPS[i].abbr);
    if (i < ROUTE_STOPS.length - 1) {
      visual.push(!busState.isAtStop && !wrapping && i === busState.closestIndex ? " > 🚌 > " : "·");
    }
  }
  return visual.join("");
}

function addLabel(container, text, size, color = "#8E8E93", bold = false) {
  const label = container.addText(text);
  label.textColor = new Color(color);
  label.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  return label;
}

async function createWidget(shuttle, needsSetup = false) {
  const widget = new ListWidget();
  const offline = isBusOffline();
  const stale = shuttle && shuttle.recordedAt !== null &&
    (Date.now() - shuttle.recordedAt > STALE_AFTER_MINUTES * 60000 || shuttle.recordedAt > Date.now() + 60000);
  const verified = shuttle && shuttle.recordedAt !== null && !stale;
  const gradient = new LinearGradient();
  gradient.colors = [new Color("#1c1c1e"), new Color("#000000")];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(16, 16, 16, 16);
  // Also refresh after setup, network failures, and outside service hours.
  widget.refreshAfterDate = new Date(Date.now() + 30 * 1000);
  const header = widget.addStack();
  header.centerAlignContent();
  addLabel(header, "ATLAS", 12, "#8E8E93", true);
  header.addSpacer();
  const status = needsSetup ? "SETUP" : offline ? "○ OFFLINE" : !shuttle ? "NO SIGNAL" :
    stale ? "STALE" : verified ? "● LIVE" : "UNVERIFIED";
  addLabel(header, status, 11, verified && !offline && !needsSetup ? "#32D74B" : "#FF453A", true);
  widget.addSpacer();
  if (needsSetup) {
    addLabel(widget, "Setup needed", 22, "#FFFFFF", true);
    addLabel(widget, "Run Setup Bus in Scriptable. See the README.", 12);
  } else if (offline) {
    addLabel(widget, "Outside service hours", 20, "#FFFFFF", true);
    widget.addSpacer(4);
    addLabel(widget, "Weekdays 6:45 AM–7 PM Eastern", 12);
  } else if (!shuttle) {
    addLabel(widget, "No Signal", 22, "#FFFFFF", true);
    addLabel(widget, "Check the feed, key, and connection.", 12);
  } else if (stale) {
    addLabel(widget, "Location is outdated", 20, "#FFFFFF", true);
    addLabel(widget, "No live ETA available", 12);
  } else {
    const bus = getBusState(shuttle.latitude, shuttle.longitude);
    const distance = calculateDistanceInMiles(shuttle.latitude, shuttle.longitude, bus.nextStop.lat, bus.nextStop.lon);
    const eta = calculateETAInMinutes(distance, shuttle.speed);
    addLabel(widget, bus.isAtStop ? "At: " + bus.currentStop.abbr : "On the way to: " + bus.nextStop.abbr, 14, "#32D74B", true);
    widget.addSpacer(4);
    const etaStack = widget.addStack();
    etaStack.bottomAlignContent();
    addLabel(etaStack, eta === 0 ? "HERE" : String(eta), 44, "#FFFFFF");
    if (eta !== 0) {
      etaStack.addSpacer(4);
      addLabel(etaStack, "min to " + bus.nextStop.abbr, 16, "#8E8E93", true);
    }
    widget.addSpacer(2);
    addLabel(widget, "Moving at " + Math.round(shuttle.speed) + " mph", 11);
    widget.addSpacer();
    addLabel(widget, "Leaves ATL: " + getNextScheduledTimes().join(" • "), 10);
    widget.addSpacer(6);
    const route = widget.addStack();
    route.centerAlignContent();
    addLabel(route, generateRouteVisual(bus), 11, "#0A84FF", true).minimumScaleFactor = 0.5;
  }
  widget.addSpacer();
  return widget;
}

const connection = readConnection();
const shuttleData = connection && !isBusOffline() ? await fetchShuttleData(connection) : null;
const widget = await createWidget(shuttleData, !connection);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
