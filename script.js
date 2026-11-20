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
const MIN_STOP_INTERVAL_MS = 5000;
const MAX_STOP_INTERVAL_MS = 2 * 60000;
const MAX_STOP_SPEED_MPH = 5;
const HISTORY_ROWS = 1000;
const ETA_WINDOW_MS = 7 * 86400000;
const ETA_MATCH_MILES = 0.15;
const ETA_HEADING_MATCH_MILES = 0.30;
const LIVE_DETAIL_AGE_MS = 2 * 60000;
const THURSDAY_NIGHT = {
  themeStarts: 21 * 60,
  routeStarts: 22 * 60,
  fridayEnds: 3 * 60, // Provisional end of the Thursday night window.
};
const SERVICE_CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: SERVICE_TIME_ZONE, weekday: "short",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

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
  // The mapped Arch landmark anchors the pickup area (OpenStreetMap node 4886558902).
  ARCH: { name: "The Arch", latitude: 33.9575243, longitude: -83.3752855, radius: 0.05 },
};

// Checkpoint centers are public bridge coordinates from the National Bridge Inventory.
// The areas include nearby roads and ramps. They are never passenger stops.
const AREAS = {
  exit7: { name: "Exit 7 · College Station Rd", latitude: 33.933906, longitude: -83.368394, radius: 0.22 },
  exit8: { name: "Exit 8 · Lexington Rd", latitude: 33.946639, longitude: -83.356053, radius: 0.22 },
  river: { name: "North Oconee River", latitude: 33.954533, longitude: -83.367967, radius: 0.18 },
};

const ACTIVE_ROUTE = "magnolia-detour";
const ROUTES = {
  "magnolia-detour": {
    stops: ["ATL", "JOUR", "TATE", "BOYD", "COL", "ADER", "JOE"],
    exitsAfter: { ATL: 7, JOE: 8 },
    areasAfter: { ATL: [AREAS.exit7], JOE: [AREAS.exit8] },
    // Begin learning from deployment-era trips so the previous route cannot skew ETAs.
    etaHistoryFrom: "2026-11-20T03:40:00Z",
  },
  regular: {
    stops: ["ATL", "MAIN", "JOUR", "TATE", "BOYD", "COL", "ADER", "JOE"],
    exitsAfter: {},
    etaHistoryFrom: null,
  },
  "thursday-night": {
    stops: ["ATL", "ARCH"],
    exitsAfter: {},
    areasAfter: { ATL: [AREAS.exit8, AREAS.river], ARCH: [AREAS.river, AREAS.exit8] },
    allowPartialArrivals: true,
    etaHistoryFrom: "2026-11-20T03:00:00Z",
  },
};

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
  const parts = SERVICE_CLOCK_FORMAT.formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return { weekday: value("weekday"), minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

function isNightRoute({ weekday, minutes }) {
  return (weekday === "Thu" && minutes >= THURSDAY_NIGHT.routeStarts) ||
    (weekday === "Fri" && minutes < THURSDAY_NIGHT.fridayEnds);
}

function serviceFor(now) {
  const clock = serviceClock(now);
  const night = isNightRoute(clock);
  const disco = night || (clock.weekday === "Thu" && clock.minutes >= THURSDAY_NIGHT.themeStarts);
  const profile = night ? "thursday-night" : ACTIVE_ROUTE;
  return { night, disco, profile, route: ROUTES[profile] };
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

function nextStop(route, stop) {
  return route.stops[(route.stops.indexOf(stop) + 1) % route.stops.length];
}

function stopCandidate(route, point) {
  if (!point || point.speed > MAX_STOP_SPEED_MPH) return null;
  const matches = route.stops.filter(stop => distanceInMiles(point, STOPS[stop]) <= STOPS[stop].radius);
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

function isUnexpectedHighwayStop(route, visit, stop) {
  return Boolean(route.exitsAfter[visit?.stop] && nextStop(route, visit.stop) !== stop);
}

function observeProgress(route, progress, sample) {
  const previous = progress?.sample;
  const before = progress?.before;
  const continuous = previous && sample.recordedAt - previous.recordedAt <= MAX_PROGRESS_GAP_MS;
  let visit = continuous && progress.visit &&
    sample.recordedAt - progress.visit.at <= MAX_PROGRESS_AGE_MS ? progress.visit : null;
  const stop = stopCandidate(route, sample);
  const previousStop = stopCandidate(route, previous);
  const gap = previous ? sample.recordedAt - previous.recordedAt : Infinity;
  let dwell = stop ? sample : null;
  if (stop && stop === previousStop) {
    // The feed sends some parked fixes roughly five minutes apart.
    const stationary = gap <= 6 * 60000 && previous.speed !== null && previous.speed <= 1 &&
      sample.speed !== null && sample.speed <= 1 && distanceInMiles(previous, sample) <= 0.01;
    const start = gap <= MAX_STOP_INTERVAL_MS ? progress.dwell || previous : previous;
    const elapsed = sample.recordedAt - start.recordedAt;
    const drift = distanceInMiles(start, sample);
    if ((gap <= MAX_STOP_INTERVAL_MS || stationary) && drift <= 0.025 &&
        (elapsed < MIN_STOP_INTERVAL_MS || drift * 3600000 / elapsed <= MAX_STOP_SPEED_MPH)) {
      dwell = start;
      // Resync past a missed highway destination only with a dwell near the
      // center of a stop. A repeated fix at the geofence edge is ambiguous.
      const target = STOPS[stop];
      const reliableDwell = !isUnexpectedHighwayStop(route, visit, stop) || visit.stop === stop ||
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
    if (!isUnexpectedHighwayStop(route, visit, previousStop) && previous.speed !== null && previous.speed <= 3 &&
        distanceInMiles(previous, target) <= target.radius / 2 &&
        isNearbyOutside(before, target) && isNearbyOutside(sample, target)) {
      visit = { stop: previousStop, at: previous.recordedAt, arrival: previous.recordedAt };
    }
  }
  return { sample, before: continuous ? previous : null, dwell, visit };
}

function readObservations(feed, now, night) {
  const byTime = new Map();
  for (const point of feed.history) {
    const time = point.recordedAt;
    if (time !== null && time <= feed.latest.recordedAt && time >= now - ETA_WINDOW_MS &&
        !byTime.has(time) && isNightRoute(serviceClock(new Date(time))) === night) {
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

function progressScope(url, { profile, route }) {
  // A feed or route edit invalidates progress without copying the URL or key.
  const identity = JSON.stringify([url, THURSDAY_NIGHT, profile, route, route.stops.map(stop => STOPS[stop])]);
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function headingDifference(first, second) {
  if (!(first.speed > 5 && second.speed > 5) || first.heading === null || second.heading === null) return null;
  const difference = Math.abs(first.heading - second.heading);
  return Math.min(difference, 360 - difference);
}

function matchingTravelTime(samples, latest, arrival) {
  let match = null;
  for (const sample of samples) {
    if (sample.recordedAt >= arrival || arrival - sample.recordedAt > MAX_PROGRESS_AGE_MS) continue;
    const heading = headingDifference(sample, latest);
    if (heading !== null && heading > 60) continue;
    const distance = distanceInMiles(sample, latest);
    const tolerance = heading === null ? ETA_MATCH_MILES : ETA_HEADING_MATCH_MILES;
    if (distance <= tolerance && (!match || distance < match.distance)) {
      match = { distance, remaining: arrival - sample.recordedAt };
    }
  }
  return match;
}

function observedTravelTimes(route, observations, tracking) {
  const firstEligibleTime = Date.parse(route.etaHistoryFrom);
  const origin = tracking.visit.stop;
  const destination = nextStop(route, origin);
  const matches = [];
  let progress = null;
  let legSamples = [];
  for (const point of observations) {
    if (point.recordedAt < firstEligibleTime) continue;
    if (point.recordedAt >= tracking.sample.recordedAt) break;
    const priorVisit = progress?.visit;
    const previous = progress?.sample;
    progress = observeProgress(route, progress, point);
    const visit = progress.visit;
    // A park confirmation can arrive after a gap. Its arrival is the fix
    // before the gap, so only evidence up to that earlier fix is eligible.
    if (previous && point.recordedAt - previous.recordedAt > MAX_PROGRESS_GAP_MS &&
        visit?.arrival !== previous.recordedAt) legSamples = [];
    if (visit && visit !== priorVisit) {
      if (visit.stop === destination) {
        const fullLeg = priorVisit?.stop === origin && visit.arrival - priorVisit.at <= MAX_PROGRESS_AGE_MS;
        const partialLeg = route.allowPartialArrivals && !priorVisit && legSamples.length >= 3 &&
          legSamples.some(sample => visit.arrival - sample.recordedAt <= MAX_PROGRESS_AGE_MS &&
            distanceInMiles(sample, STOPS[destination]) > 0.25);
        if (fullLeg || partialLeg) {
          const match = matchingTravelTime(legSamples, tracking.sample, visit.arrival);
          if (match) matches.push(match);
        }
      }
      legSamples = [];
    }
    if (!visit || point.recordedAt > visit.at) legSamples.push(point);
  }
  return matches;
}

function historicalETA(route, observations, tracking, now) {
  const { sample, before, visit } = tracking;
  const age = Math.max(0, now - sample.recordedAt);
  const moving = sample.speed > MAX_STOP_SPEED_MPH;
  const movedRecently = before && sample.recordedAt - before.recordedAt <= LIVE_DETAIL_AGE_MS &&
    distanceInMiles(before, sample) > 0.025;
  if (!route.etaHistoryFrom || age > LIVE_DETAIL_AGE_MS || (!moving && !movedRecently) ||
      distanceInMiles(sample, STOPS[visit.stop]) <= STOPS[visit.stop].radius) return null;
  const matches = observedTravelTimes(route, observations, tracking);
  if (!matches.length) return null;
  const times = matches.map(match => match.remaining);
  times.sort((first, second) => first - second);
  const middle = Math.floor(times.length / 2);
  const median = (times[middle] + times[Math.floor((times.length - 1) / 2)]) / 2;
  if (times[times.length - 1] - times[0] > Math.max(2 * 60000, median / 2)) return null;
  const remaining = (median - (moving ? age : 0)) / 60000;
  if (remaining <= 0) return null;
  const closeMatches = matches.filter(match => match.distance <= ETA_MATCH_MILES).length;
  if (closeMatches >= 2 && moving) return String(Math.max(1, Math.round(remaining)));
  const earliest = Math.max(1, Math.floor(remaining - 1));
  const latest = Math.max(earliest + 1, Math.ceil(remaining + 1));
  return earliest + "–" + latest;
}

function routeArea(route, progress, destination, observations, now) {
  const { sample, before, visit } = progress;
  if (now - sample.recordedAt > LIVE_DETAIL_AGE_MS) return null;
  const origin = visit.stop;
  const from = STOPS[origin];
  const to = STOPS[destination];
  const nearPrevious = before && sample.recordedAt - before.recordedAt <= LIVE_DETAIL_AGE_MS;
  const toDistance = distanceInMiles(sample, to);
  const fromDistance = distanceInMiles(sample, from);
  if (nearPrevious && toDistance <= 0.22 && toDistance < fromDistance &&
      distanceInMiles(before, to) - toDistance >= 0.02) return "Approaching " + to.name;
  const areas = route.areasAfter?.[origin] || [];
  const nearby = areas.find(area => distanceInMiles(sample, area) <= area.radius);
  if (nearby) return "Near " + nearby.name;
  if (nearPrevious && fromDistance > from.radius && fromDistance <= 0.35 && fromDistance < toDistance &&
      fromDistance - distanceInMiles(before, from) >= 0.02) return "Leaving " + from.name;
  const after = Math.max(visit.at, sample.recordedAt - 3 * 60000);
  if (before && before.recordedAt > after) {
    const passed = areas.find(area => distanceInMiles(before, area) <= area.radius);
    if (passed) return "Past " + passed.name;
  }
  for (let i = observations.length - 1; i >= 0 && observations[i].recordedAt > after; i--) {
    const passed = areas.find(area => distanceInMiles(observations[i], area) <= area.radius);
    if (passed) return "Past " + passed.name;
  }
  return null;
}

function trackBus(feed, url, service, now) {
  if (!feed) return { status: "NO SIGNAL" };
  const { latest } = feed;
  if (latest.recordedAt === null) return { status: "UNVERIFIED" };
  if (now - latest.recordedAt > STALE_AFTER_MS || latest.recordedAt > now + 60000) return { status: "STALE" };
  const { night, route } = service;

  const scope = progressScope(url, service);
  const saved = readProgress(scope);
  if (saved && latest.recordedAt < saved.sample.recordedAt) return { status: "STALE" };
  // A fresh fix from the other service window can't establish progress on this route.
  if (isNightRoute(serviceClock(new Date(latest.recordedAt))) !== night) return { status: "● LIVE" };
  const observations = readObservations(feed, now, night);
  let progress = saved;
  for (const point of observations) {
    if (point.recordedAt < now - MAX_PROGRESS_AGE_MS ||
        (progress && point.recordedAt <= progress.sample.recordedAt)) continue;
    progress = observeProgress(route, progress, point);
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
  const next = nextStop(route, stop);
  return {
    status: "● LIVE",
    at: atStop ? stop : null,
    next,
    exit: route.exitsAfter[stop],
    area: atStop ? null : routeArea(route, progress, next, observations, now),
    eta: atStop ? null : historicalETA(route, observations, progress, now),
  };
}

function addLabel(container, text, size, color = "#8E8E93", bold = false) {
  const label = container.addText(text);
  label.textColor = new Color(color);
  label.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  return label;
}

function createWidget(bus, service, now) {
  const widget = new ListWidget();
  const { disco, night, route } = service;
  const live = bus.status === "● LIVE";
  const accent = disco ? "#5CF5D8" : "#0A84FF";
  const highlight = disco ? "#FFD098" : "#32D74B";
  const muted = disco ? "#FFE1F4" : "#8E8E93";
  const gradient = new LinearGradient();
  const background = disco ? ["#2A123E", "#711D55", "#782E2F", "#1E152D"] : ["#1c1c1e", "#000000"];
  gradient.colors = background.map(color => new Color(color));
  gradient.locations = disco ? [0, 0.48, 0.78, 1] : [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(16, 16, 16, 16);
  // iOS schedules the actual refresh.
  widget.refreshAfterDate = new Date(now.getTime() + 30 * 1000);
  const header = widget.addStack();
  header.centerAlignContent();
  addLabel(header, disco ? "ATLAS  🪩 🍾" : "ATLAS", 12, muted, true);
  header.addSpacer();
  addLabel(header, bus.status, 11, live ? (disco ? accent : highlight) : (disco ? "#FFC7D0" : "#FF453A"), true);
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
    if (bus.at) addLabel(widget, "Next: " + STOPS[bus.next].name, 12, muted);
    if (bus.area) {
      const area = addLabel(widget, bus.area, 12, accent, true);
      area.lineLimit = 1;
      area.minimumScaleFactor = 0.7;
    }
  }
  if (bus.status !== "SETUP" && bus.status !== "NO SIGNAL") {
    const eta = bus.eta ? "Approx. " + bus.eta + " min" : "ETA unavailable";
    const detail = bus.exit ? "Highway via Exit " + bus.exit + " · " + eta : eta;
    addLabel(widget, detail, 12, bus.eta ? highlight : muted, Boolean(bus.eta));
  }
  widget.addSpacer();
  const scheduleText = night ? "Thursday night shuttle · 10 PM start" :
    disco ? "The Arch shuttle starts at 10 PM" : "Atlas schedule · " + getNextScheduledTimes(now).join(" • ");
  const schedule = addLabel(widget, scheduleText, 10, muted);
  schedule.lineLimit = 1;
  schedule.minimumScaleFactor = 0.7;
  widget.addSpacer(4);
  const routeLabel = addLabel(widget, [...route.stops, route.stops[0]].join(" → "), 11, accent, true);
  routeLabel.lineLimit = 1;
  routeLabel.minimumScaleFactor = 0.65;
  widget.addSpacer();
  return widget;
}

const connection = readConnection();
const feed = connection ? await fetchShuttleData(connection) : null;
const now = new Date();
const service = serviceFor(now);
const bus = connection
  ? trackBus(feed, connection.url, service, now.getTime())
  : { status: "SETUP" };
const widget = createWidget(bus, service, now);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
