// Variables used by Scriptable.
// icon-color: blue; icon-glyph: bus;

// ATLAS shuttle tracker. Run setup-bus.js on your device before using this widget.
// No endpoint or API credentials are stored in this file.
const SETTINGS_KEY = "atlas-shuttle-connection";
const PROGRESS_KEY = "atlas-shuttle-route-progress-v1";
const SERVICE_TIME_ZONE = "America/New_York";
const STALE_AFTER_MS = 10 * 60000;
const MAX_PROGRESS_AGE_MS = 15 * 60000;
const MAX_PROGRESS_GAP_MS = 4 * 60000;
const MIN_STOP_INTERVAL_MS = 8000;
const MAX_STOP_INTERVAL_MS = 2 * 60000;
const MAX_STOP_SPEED_MPH = 5;
const HISTORY_ROWS = 1000;
const ETA_WINDOW_MS = 7 * 86400000;
const ETA_MATCH_MILES = 0.15;

// Monday–Friday departures from Atlas. Verify the current timetable with the operator.
const SCHEDULED_TIMES = [
  "7:15 AM", "8:00 AM", "8:45 AM", "9:30 AM", "10:15 AM", "11:00 AM",
  "11:45 AM", "12:30 PM", "1:30 PM", "2:15 PM", "3:00 PM", "3:45 PM",
  "4:30 PM", "5:15 PM", "6:00 PM"
];

// Geofence radii are in miles.
const STOPS = {
  ATL: { name: "Atlas Athens", latitude: 33.943026, longitude: -83.338263, radius: 0.10 },
  MAIN: { name: "Main Library", latitude: 33.954941, longitude: -83.373093, radius: 0.05 },
  JOUR: { name: "Journalism", latitude: 33.951909, longitude: -83.373336, radius: 0.05 },
  TATE: { name: "Tate", latitude: 33.950908, longitude: -83.374164, radius: 0.05 },
  BOYD: { name: "Boyd", latitude: 33.946293, longitude: -83.376286, radius: 0.05 },
  COL: { name: "Coliseum", latitude: 33.942599, longitude: -83.376988, radius: 0.05 },
  ADER: { name: "Aderhold", latitude: 33.941406, longitude: -83.373222, radius: 0.05 },
  JOE: { name: "Joe Frank", latitude: 33.939599, longitude: -83.370638, radius: 0.05 },
};

const ACTIVE_ROUTE = "magnolia-detour";
const ROUTES = {
  "magnolia-detour": {
    stops: ["ATL", "JOUR", "TATE", "BOYD", "COL", "ADER", "JOE"],
    exitsAfter: { ATL: 7, JOE: 8 },
    // Begin learning from deployment-era trips so the previous route cannot skew ETAs.
    etaHistoryFrom: "2026-11-20T03:40:00Z",
  },
  regular: {
    stops: ["ATL", "MAIN", "JOUR", "TATE", "BOYD", "COL", "ADER", "JOE"],
    exitsAfter: {},
    etaHistoryFrom: null,
  },
};
const ROUTE = ROUTES[ACTIVE_ROUTE];

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
  const { url, key } = connection;
  const params = (url.split("?")[1] || "").split("&");
  // Expand only the existing newest-first, single-bus query. Custom feeds can supply
  // their own history, and the saved Keychain URL is used as the fallback.
  const historyURL = params.includes("order=recorded_at.desc") &&
    params.some(param => /^bus_id=eq\..+$/.test(param))
    ? url.replace(/([?&])limit=1(?=&|$)/, "$1limit=" + HISTORY_ROWS) : url;
  let data = await requestLocations(historyURL, key);
  if (data === null && historyURL !== url) data = await requestLocations(url, key);
  const rows = Array.isArray(data) ? data : [data];
  const latest = parseCoordinates(rows[0]);
  if (!latest) return null;
  return { latest, history: rows.map(parseCoordinates).filter(Boolean) };
}

async function requestLocations(url, key) {
  const req = new Request(url);
  req.headers = { Accept: "application/json", apikey: key };
  // Modern publishable keys belong in apikey, not a Bearer JWT header.
  if (key.startsWith("eyJ")) {
    req.headers.Authorization = "Bearer " + key;
  }
  req.timeoutInterval = 10;
  try {
    const data = await req.loadJSON();
    const status = req.response && req.response.statusCode;
    if (!status || status < 200 || status >= 300) return null;
    return data;
  } catch (_) {
    // Avoid logging connection URLs, response bodies, or credentials.
    console.warn("[Bus] Unable to fetch location. Check connection settings and network.");
    return null;
  }
}

function parseCoordinates(record) {
  if (!record || typeof record !== "object") return null;
  const lat = record.latitude ?? record.lat ?? record.location?.latitude;
  const lon = record.longitude ?? record.lng ?? record.lon ?? record.location?.longitude;
  if (lat == null || lon == null || String(lat).trim() === "" || String(lon).trim() === "") return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const speed = readNonnegativeNumber(record.speed_mph);
  const heading = readNonnegativeNumber(record.heading);
  const time = record.recorded_at;
  const timestamp = typeof time === "string" && /[T ]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(time)
    ? Date.parse(time) : NaN;
  return {
    latitude, longitude, speed, heading: heading !== null && heading < 360 ? heading : null,
    recordedAt: Number.isFinite(timestamp) ? timestamp : null,
  };
}

function readNonnegativeNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function serviceClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SERVICE_TIME_ZONE, weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return { weekday: value("weekday"), minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

function distanceInMiles(first, second) {
  const { latitude: lat1, longitude: lon1 } = first;
  const { latitude: lat2, longitude: lon2 } = second;
  const toRad = degrees => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}

function getNextScheduledTimes(now = new Date()) {
  const clock = serviceClock(now);
  if (["Sat", "Sun"].includes(clock.weekday)) return ["Weekdays only"];
  if (clock.minutes < 405) return ["Weekdays 6:45 AM–7 PM ET"];
  if (clock.minutes >= 1140) return ["Done for today"];
  const upcoming = SCHEDULED_TIMES.filter(timeString => {
    const [time, modifier] = timeString.split(" ");
    const [hours, minutes] = time.split(":").map(Number);
    return (hours % 12 + (modifier === "PM" ? 12 : 0)) * 60 + minutes >= clock.minutes;
  }).slice(0, 3);
  return upcoming.length ? upcoming : ["Done for today"];
}

function nextStop(stop) {
  return ROUTE.stops[(ROUTE.stops.indexOf(stop) + 1) % ROUTE.stops.length];
}

function stopCandidate(point) {
  if (!point || point.speed > MAX_STOP_SPEED_MPH) return null;
  const matches = ROUTE.stops.filter(stop => distanceInMiles(point, STOPS[stop]) <= STOPS[stop].radius);
  return matches.length === 1 ? matches[0] : null;
}

function isStopInterval(first, second) {
  const gap = second.recordedAt - first.recordedAt;
  return gap >= MIN_STOP_INTERVAL_MS && gap <= MAX_STOP_INTERVAL_MS;
}

function isNearbyOutside(point, stop) {
  const distance = distanceInMiles(point, stop);
  return distance > stop.radius && distance <= 0.45 && !(point.speed > 30);
}

function isUnexpectedHighwayStop(visit, stop) {
  return Boolean(ROUTE.exitsAfter[visit?.stop] && nextStop(visit.stop) !== stop);
}

function observeProgress(progress, sample) {
  const previous = progress?.sample;
  const before = progress?.before;
  const continuous = previous && sample.recordedAt - previous.recordedAt <= MAX_PROGRESS_GAP_MS;
  let visit = continuous && progress.visit &&
    sample.recordedAt - progress.visit.at <= MAX_PROGRESS_AGE_MS ? progress.visit : null;
  const stop = stopCandidate(sample);
  const previousStop = stopCandidate(previous);
  let dwell = stop ? sample : null;
  if (stop && stop === previousStop && sample.recordedAt - previous.recordedAt <= MAX_STOP_INTERVAL_MS) {
    const start = progress.dwell || previous;
    const elapsed = sample.recordedAt - start.recordedAt;
    const drift = distanceInMiles(start, sample);
    if (drift <= 0.025 && (elapsed < MIN_STOP_INTERVAL_MS || drift * 3600000 / elapsed <= MAX_STOP_SPEED_MPH)) {
      dwell = start;
      // Resync past a missed highway destination only with a dwell near the
      // center of a stop. A repeated fix at the geofence edge is ambiguous.
      const target = STOPS[stop];
      const reliableDwell = !isUnexpectedHighwayStop(visit, stop) || visit.stop === stop ||
        (distanceInMiles(start, target) <= target.radius / 2 &&
          distanceInMiles(sample, target) <= target.radius / 2);
      if (elapsed >= MIN_STOP_INTERVAL_MS && reliableDwell) {
        visit = { stop, at: sample.recordedAt, arrival: start.recordedAt };
      }
    }
  } else if (previousStop && before && isStopInterval(before, previous) && isStopInterval(previous, sample)) {
    // Minute-spaced feeds may see a short visit only once. Require a crawl in
    // the center of one stop, bracketed by a nearby approach and departure.
    // During a highway leg, only its destination qualifies for this shortcut.
    const target = STOPS[previousStop];
    if (!isUnexpectedHighwayStop(visit, previousStop) && previous.speed !== null && previous.speed <= 3 &&
        distanceInMiles(previous, target) <= target.radius / 2 &&
        isNearbyOutside(before, target) && isNearbyOutside(sample, target)) {
      visit = { stop: previousStop, at: previous.recordedAt, arrival: previous.recordedAt };
    }
  }
  return { sample, before: continuous ? previous : null, dwell, visit };
}

function readObservations(feed, now) {
  const byTime = new Map();
  for (const point of feed.history) {
    const time = point.recordedAt;
    if (time !== null && time <= feed.latest.recordedAt && time >= now - ETA_WINDOW_MS && !byTime.has(time)) {
      byTime.set(time, point);
    }
  }
  return Array.from(byTime.values()).sort((first, second) => first.recordedAt - second.recordedAt);
}

function readProgress(scope) {
  try {
    if (!Keychain.contains(PROGRESS_KEY)) return null;
    const saved = JSON.parse(Keychain.get(PROGRESS_KEY));
    return saved.scope === scope && Number.isFinite(saved.progress?.sample?.recordedAt) ? saved.progress : null;
  } catch (_) {
    return null;
  }
}

function progressScope(url) {
  // A feed or route edit invalidates progress without copying the URL or key.
  const identity = JSON.stringify([url, ACTIVE_ROUTE, ROUTE, ROUTE.stops.map(stop => STOPS[stop])]);
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function matchingDirection(first, second) {
  if (first.speed < 5 || second.speed < 5 || first.heading === null || second.heading === null) return true;
  const difference = Math.abs(first.heading - second.heading);
  return Math.min(difference, 360 - difference) <= 60;
}

function matchingTravelTime(samples, latest, arrival) {
  let closest = ETA_MATCH_MILES;
  let remaining = null;
  for (const sample of samples) {
    if (sample.recordedAt >= arrival || !matchingDirection(sample, latest)) continue;
    const distance = distanceInMiles(sample, latest);
    if (distance <= closest) {
      closest = distance;
      remaining = arrival - sample.recordedAt;
    }
  }
  return remaining;
}

function historicalETA(observations, tracking, now) {
  if (!ROUTE.etaHistoryFrom || !(tracking.sample.speed > MAX_STOP_SPEED_MPH) ||
      now - tracking.sample.recordedAt > 2 * 60000) return null;
  const firstEligibleTime = Date.parse(ROUTE.etaHistoryFrom);
  const origin = tracking.visit.stop;
  const destination = nextStop(origin);
  const times = [];
  let progress = null;
  let legSamples = [];
  for (const point of observations) {
    if (point.recordedAt < firstEligibleTime) continue;
    if (point.recordedAt >= tracking.sample.recordedAt) break;
    const priorVisit = progress?.visit;
    progress = observeProgress(progress, point);
    const visit = progress.visit;
    if (!visit || visit !== priorVisit) {
      if (visit?.stop === destination && priorVisit?.stop === origin &&
          visit.arrival - priorVisit.at <= MAX_PROGRESS_AGE_MS) {
        const time = matchingTravelTime(legSamples, tracking.sample, visit.arrival);
        if (time !== null) times.push(time);
      }
      legSamples = [];
    }
    if (visit && point.recordedAt > visit.at) legSamples.push(point);
  }
  if (times.length < 2) return null;
  times.sort((first, second) => first - second);
  const middle = Math.floor(times.length / 2);
  const median = (times[middle] + times[Math.floor((times.length - 1) / 2)]) / 2;
  if (times[times.length - 1] - times[0] > Math.max(2 * 60000, median / 2)) return null;
  const remaining = median - Math.max(0, now - tracking.sample.recordedAt);
  return remaining > 0 ? Math.max(1, Math.round(remaining / 60000)) : null;
}

function trackBus(feed, url, now = Date.now()) {
  if (!feed) return { status: "NO SIGNAL" };
  const { latest } = feed;
  if (latest.recordedAt === null) return { status: "UNVERIFIED" };
  if (now - latest.recordedAt > STALE_AFTER_MS || latest.recordedAt > now + 60000) return { status: "STALE" };

  const scope = progressScope(url);
  const saved = readProgress(scope);
  if (saved && latest.recordedAt < saved.sample.recordedAt) return { status: "STALE" };
  const observations = readObservations(feed, now);
  let progress = saved;
  for (const point of observations) {
    if (point.recordedAt < now - MAX_PROGRESS_AGE_MS ||
        (progress && point.recordedAt <= progress.sample.recordedAt)) continue;
    progress = observeProgress(progress, point);
  }
  if (progress !== saved) {
    try {
      Keychain.set(PROGRESS_KEY, JSON.stringify({ scope, progress }));
    } catch (_) {
      console.warn("[Bus] Unable to save route progress.");
    }
  }
  const stop = progress?.visit?.stop;
  if (!stop) return { status: "● LIVE", next: null };
  const atStop = progress.visit.at === latest.recordedAt;
  return {
    status: "● LIVE",
    at: atStop ? stop : null,
    next: nextStop(stop),
    exit: ROUTE.exitsAfter[stop],
    eta: atStop ? null : historicalETA(observations, progress, now),
  };
}

function addLabel(container, text, size, color = "#8E8E93", bold = false) {
  const label = container.addText(text);
  label.textColor = new Color(color);
  label.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  return label;
}

function createWidget(bus) {
  const widget = new ListWidget();
  const live = bus.status === "● LIVE";
  const gradient = new LinearGradient();
  gradient.colors = [new Color("#1c1c1e"), new Color("#000000")];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(16, 16, 16, 16);
  // iOS schedules the actual refresh.
  widget.refreshAfterDate = new Date(Date.now() + 30 * 1000);
  const header = widget.addStack();
  header.centerAlignContent();
  addLabel(header, "ATLAS", 12, "#8E8E93", true);
  header.addSpacer();
  addLabel(header, bus.status, 11, live ? "#32D74B" : "#FF453A", true);
  widget.addSpacer();
  if (bus.status === "SETUP") {
    addLabel(widget, "Setup needed", 22, "#FFFFFF", true);
    addLabel(widget, "Run Setup Bus in Scriptable. See the README.", 12);
  } else if (bus.status === "NO SIGNAL") {
    addLabel(widget, "No Signal", 22, "#FFFFFF", true);
    addLabel(widget, "Check the feed, key, and connection.", 12);
  } else if (bus.status === "STALE") {
    addLabel(widget, "Location is outdated", 20, "#FFFFFF", true);
  } else {
    const headline = bus.at ? "At: " + STOPS[bus.at].name :
      bus.next ? "Next: " + STOPS[bus.next].name : "Route position unknown";
    addLabel(widget, headline, 18, "#FFFFFF", true);
    if (bus.at) addLabel(widget, "Next: " + STOPS[bus.next].name, 12);
  }
  if (bus.status !== "SETUP" && bus.status !== "NO SIGNAL") {
    const eta = bus.eta ? "Approx. " + bus.eta + " min" : "ETA unavailable";
    const detail = bus.exit ? "Highway via Exit " + bus.exit + " · " + eta : eta;
    addLabel(widget, detail, 12, bus.eta ? "#32D74B" : "#8E8E93");
  }
  widget.addSpacer();
  const schedule = addLabel(widget, "Atlas schedule · " + getNextScheduledTimes().join(" • "), 10);
  schedule.lineLimit = 1;
  schedule.minimumScaleFactor = 0.7;
  widget.addSpacer(4);
  const route = addLabel(widget, [...ROUTE.stops, ROUTE.stops[0]].join(" → "), 11, "#0A84FF", true);
  route.lineLimit = 1;
  route.minimumScaleFactor = 0.65;
  widget.addSpacer();
  return widget;
}

const connection = readConnection();
const bus = connection
  ? trackBus(await fetchShuttleData(connection), connection.url)
  : { status: "SETUP" };
const widget = createWidget(bus);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
