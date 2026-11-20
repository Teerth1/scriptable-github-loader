const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(new URL("../script.js", "file://" + __filename), "utf8");
const setup = fs.readFileSync(new URL("../setup-bus.js", "file://" + __filename), "utf8");
const definitions = source.slice(0, source.indexOf("const connection = readConnection();"));
const NOW = Date.parse("2026-11-20T15:00:00Z");
const STOPS = {
  ATL: [33.943026, -83.338263],
  MAIN: [33.954941, -83.373093],
  JOUR: [33.951909, -83.373336],
  TATE: [33.950908, -83.374164],
  BOYD: [33.946293, -83.376286],
  COL: [33.942599, -83.376988],
  ADER: [33.941406, -83.373222],
  JOE: [33.939599, -83.370638],
  ARCH: [33.9575243, -83.3752855],
};
const EXIT_7 = [33.933906, -83.368394];
const EXIT_8 = [33.946639, -83.356053];
const OCONEE_RIVER = [33.954533, -83.367967];

function fix(place, seconds, speed = 0, heading = 90, now = NOW) {
  const [latitude, longitude] = STOPS[place] || place;
  return { latitude, longitude, speed_mph: speed, heading, recorded_at: new Date(now + seconds * 1000).toISOString() };
}

async function widgetFor(rows, options = {}) {
  const h = harness({ secrets: connection(), record: rows.slice().reverse(), ...options });
  await h.run(source);
  return h;
}

function harness(options = {}) {
  const events = { requests: [], texts: [], complete: 0, previews: 0, widgets: [] };
  const secrets = options.secrets || new Map();
  const fixedNow = options.now ?? NOW;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  }
  const stack = () => ({
    addText(text) { events.texts.push(text); return {}; },
    addSpacer() {}, centerAlignContent() {}, bottomAlignContent() {},
    addStack: () => stack(),
  });
  const context = {
    Date: Clock, Intl, config: { runsInWidget: !options.inApp },
    Keychain: {
      contains: key => secrets.has(key), get: key => secrets.get(key),
      set: (key, value) => secrets.set(key, value), remove: key => secrets.delete(key),
    },
    Request: class {
      constructor(url) { this.url = url; events.requests.push(this); }
      async loadJSON() {
        if (options.networkError) throw new Error("private error");
        if (options.respond) {
          const result = options.respond(this.url);
          this.response = { statusCode: result.status };
          return result.data;
        }
        this.response = { statusCode: options.status || 200 };
        return options.record ?? [fix("ATL", 0, 0, 90, fixedNow), fix("ATL", -60, 0, 90, fixedNow)];
      }
    },
    ListWidget: class {
      constructor() { Object.assign(this, stack()); }
      setPadding() {}
      async presentMedium() { events.previews++; }
    },
    LinearGradient: class {}, Color: class { constructor(hex) { this.hex = hex; } },
    Font: { boldSystemFont() {}, systemFont() {} },
    console: { warn() {} },
    Script: { complete: () => events.complete++, setWidget: widget => events.widgets.push(widget) },
    Alert: class {
      addTextField() {} addSecureTextField() {} addAction() {} addCancelAction() {}
      async presentAlert() { return options.cancel ? -1 : 0; }
      textFieldValue(index) { return (options.inputs || [])[index] || ""; }
    },
    Data: { fromBase64String: value => ({ toRawString: () => Buffer.from(value, "base64").toString() }) },
  };
  vm.createContext(context);
  const run = text => vm.runInContext("(async () => {\n" + text + "\n})()", context);
  return { context, events, secrets, run };
}
function connection(key = "sb_publishable_test", url = "https://example.supabase.co/rest/v1/bus_locations?limit=1") {
  return new Map([["atlas-shuttle-connection", JSON.stringify({ url, key })]]);
}

test("coordinate parser accepts aliases and rejects corrupt coordinates", async () => {
  const h = harness();
  await h.run(definitions + `
    globalThis.parse = parseCoordinates;
  `);
  for (const record of [null, [], {}, { latitude: "", longitude: 0 }, { lat: "bad", lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }]) {
    assert.equal(h.context.parse(record), null);
  }
  const good = h.context.parse({ lat: "33.94", lng: "-83.33", speed_mph: -2 });
  assert.equal(good.latitude, 33.94);
  assert.equal(good.longitude, -83.33);
  assert.equal(good.speed, null);
  assert.equal(good.recordedAt, null);
  assert.equal(h.context.parse({ location: { latitude: 33.94, longitude: -83.33 }, recorded_at: "2026-11-20T15:00:00" }).recordedAt, null);
});

test("service clock observes Eastern time, weekdays, and DST", async () => {
  const h = harness();
  await h.run(definitions + "globalThis.times = getNextScheduledTimes;");
  for (const date of ["2026-11-16T11:44:00Z", "2026-07-06T10:44:00Z"]) {
    assert.deepEqual(Array.from(h.context.times(new Date(date))), ["Weekdays 6:45 AM–7 PM ET"]);
  }
  for (const date of ["2026-11-16T11:45:00Z", "2026-07-06T10:45:00Z"]) {
    assert.deepEqual(Array.from(h.context.times(new Date(date))), ["7:15 AM", "8:00 AM", "8:45 AM"]);
  }
  assert.deepEqual(Array.from(h.context.times(new Date("2026-11-17T00:00:00Z"))), ["Done for today"]);
  assert.deepEqual(Array.from(h.context.times(new Date("2026-11-21T15:00:00Z"))), ["Weekdays only"]);
});

test("nighttime and weekends fetch and display live telemetry alongside the timetable", async () => {
  for (const [time, schedule] of [
    ["2026-11-21T03:00:00Z", "Done for today"],
    ["2026-11-21T15:00:00Z", "Weekdays only"],
  ]) {
    const h = harness({ secrets: connection(), now: Date.parse(time) });
    await h.run(source);
    assert.equal(h.events.requests.length, 1);
    assert.ok(h.events.texts.includes("● LIVE"));
    assert.ok(h.events.texts.includes("At: Atlas Athens"));
    assert.ok(h.events.texts.includes("Atlas schedule · " + schedule));
  }
});

test("disco theme and Arch route turn on at separate Thursday times in Eastern time", async () => {
  const dayRoute = "ATL → JOUR → TATE → BOYD → COL → ADER → JOE → ATL";
  const nightRoute = "ATL → ARCH → ATL";
  for (const [time, disco, night] of [
    ["2026-11-20T01:59:59Z", false, false], // Thursday 8:59 PM EST
    ["2026-11-20T02:00:00Z", true, false],
    ["2026-11-20T02:59:59Z", true, false],
    ["2026-11-20T03:00:00Z", true, true],
    ["2026-11-20T05:00:00Z", true, true],
    ["2026-11-20T07:59:59Z", true, true],
    ["2026-11-20T08:00:00Z", false, false],
    ["2026-11-21T03:00:00Z", false, false], // Friday 10 PM EST
    ["2026-07-10T01:00:00Z", true, false], // Thursday 9 PM EDT
    ["2026-07-10T02:00:00Z", true, true],
    ["2026-07-10T07:00:00Z", false, false],
  ]) {
    const h = harness({ secrets: connection(), now: Date.parse(time) });
    await h.run(source);
    assert.equal(h.events.texts.includes("ATLAS  🪩 🍾"), disco, time);
    assert.equal(h.events.texts.includes("The Arch shuttle starts at 10 PM"), disco && !night, time);
    assert.equal(h.events.texts.includes("Thursday night shuttle · 10 PM start"), night, time);
    assert.ok(h.events.texts.includes(night ? nightRoute : dayRoute), time);
    assert.equal(h.events.requests.length, 1, time);
    const colors = Array.from(h.events.widgets[0].backgroundGradient.colors, color => color.hex);
    assert.deepEqual(colors, disco ? ["#2A123E", "#711D55", "#782E2F", "#1E152D"] : ["#1c1c1e", "#000000"], time);
  }
});

test("Thursday night tracking alternates between Atlas and the Arch", async () => {
  const now = Date.parse("2026-11-20T05:15:00Z");
  const secrets = connection();
  const rows = [
    fix("ATL", -120, 0, 90, now), fix("ATL", -60, 0, 90, now), fix("JOUR", 0, 28, 90, now),
  ];
  const outbound = await widgetFor(rows, { secrets, now });
  assert.ok(outbound.events.texts.includes("Next: The Arch"));
  assert.ok(outbound.events.texts.includes("ETA unavailable"));
  assert.ok(!outbound.events.texts.some(text => text.includes("Exit")));
  const atArch = await widgetFor([fix("ARCH", 60, 0, 90, now), fix("ARCH", 120, 0, 90, now)], {
    secrets, now: now + 120000,
  });
  assert.ok(atArch.events.texts.includes("At: The Arch"));
  assert.ok(atArch.events.texts.includes("Next: Atlas Athens"));
  const returned = await widgetFor([fix("ATL", 240, 0, 90, now), fix("ATL", 300, 0, 90, now)], {
    secrets, now: now + 300000,
  });
  assert.ok(returned.events.texts.includes("At: Atlas Athens"));
  assert.ok(returned.events.texts.includes("Next: The Arch"));
});

test("the Arch loop names departure, verified checkpoint areas and the destination approach", async () => {
  const now = Date.parse("2026-11-27T05:45:00Z");
  const record = (place, offset, speed = 0, heading = 270) => fix(place, offset, speed, heading, now);
  const origin = [record("ATL", -240), record("ATL", -120)];
  const leaving = await widgetFor([...origin, record([33.944, -83.341], 0, 25)], { now });
  assert.ok(leaving.events.texts.includes("Leaving Atlas Athens"));
  const exit = await widgetFor([...origin, record(EXIT_8, 0, 30)], { now });
  assert.ok(exit.events.texts.includes("Near Exit 8 · Lexington Rd"));
  assert.ok(exit.events.texts.includes("Next: The Arch"));
  const river = await widgetFor([...origin, record(EXIT_8, -100, 30), record(OCONEE_RIVER, 0, 25)], { now });
  assert.ok(river.events.texts.includes("Near North Oconee River"));
  const past = await widgetFor([
    ...origin, record(OCONEE_RIVER, -100, 25), record([33.954, -83.372], -60, 14),
    record([33.954, -83.374], 0, 20),
  ], { now });
  assert.ok(past.events.texts.includes("Past North Oconee River"));
  const approaching = await widgetFor([
    ...origin, record(OCONEE_RIVER, -60, 25), record([33.956, -83.375], 0, 13),
  ], { now });
  assert.ok(approaching.events.texts.includes("Approaching The Arch"));
  const returning = await widgetFor([
    record("ARCH", -180), record("ARCH", -120), record(EXIT_8, 0, 28, 90),
  ], { now });
  assert.ok(returning.events.texts.includes("Near Exit 8 · Lexington Rd"));
  assert.ok(returning.events.texts.includes("Next: Atlas Athens"));
  const stale = await widgetFor([...origin, record(EXIT_8, -130, 30)], { now });
  assert.ok(!stale.events.texts.includes("Near Exit 8 · Lexington Rd"));
});

test("daytime exit areas follow the correct leg and never advance the passenger stop", async () => {
  const outbound = await widgetFor([fix("ATL", -180), fix("ATL", -120), fix(EXIT_7, 0, 42)]);
  assert.ok(outbound.events.texts.includes("Near Exit 7 · College Station Rd"));
  assert.ok(outbound.events.texts.includes("Next: Journalism"));
  const nearWrongExit = await widgetFor([fix("ATL", -180), fix("ATL", -120), fix(EXIT_8, 0, 42)]);
  assert.ok(!nearWrongExit.events.texts.includes("Near Exit 8 · Lexington Rd"));
  const returning = await widgetFor([fix("JOE", -180), fix("JOE", -120), fix(EXIT_8, 0, 42)]);
  assert.ok(returning.events.texts.includes("Near Exit 8 · Lexington Rd"));
  assert.ok(returning.events.texts.includes("Next: Atlas Athens"));
});

test("short slow Arch fixes and widely spaced parked Atlas fixes can confirm visits", async () => {
  const now = Date.parse("2026-11-27T05:45:00Z");
  const arch = await widgetFor([fix("ARCH", -6, 3, 90, now), fix("ARCH", 0, 0, 90, now)], { now });
  assert.ok(arch.events.texts.includes("At: The Arch"));
  const atlas = await widgetFor([fix("ATL", -300, 0, 90, now), fix("ATL", 0, 0, 90, now)], { now });
  assert.ok(atlas.events.texts.includes("At: Atlas Athens"));
  const tooFar = await widgetFor([
    fix([33.94250, -83.338263], -300, 0, 90, now), fix("ATL", 0, 0, 90, now),
  ], { now });
  assert.ok(tooFar.events.texts.includes("Route position unknown"));
});

test("Thursday route switches exclude earlier observations and saved progress from the other route", async () => {
  const start = Date.parse("2026-11-20T03:00:00Z");
  const secrets = connection();
  const dayRows = [fix("JOE", -120, 0, 90, start), fix("JOE", -60, 0, 90, start)];
  const before = await widgetFor(dayRows, { secrets, now: start - 60000 });
  assert.ok(before.events.texts.includes("Highway via Exit 8 · ETA unavailable"));
  const atStart = await widgetFor(dayRows, { secrets, now: start });
  assert.ok(atStart.events.texts.includes("Route position unknown"));
  assert.ok(atStart.events.texts.includes("ATL → ARCH → ATL"));
  const mixed = await widgetFor([
    fix("ATL", -60, 0, 90, start), fix("ATL", 0, 0, 90, start),
  ], { secrets, now: start });
  assert.ok(mixed.events.texts.includes("Route position unknown"));

  const end = Date.parse("2026-11-20T08:00:00Z");
  const nightRows = [fix("ATL", -120, 0, 90, end), fix("ATL", -60, 0, 90, end)];
  const lastNight = await widgetFor(nightRows, { secrets, now: end - 60000 });
  assert.ok(lastNight.events.texts.includes("Next: The Arch"));
  const atEnd = await widgetFor([...nightRows, fix("ATL", 0, 0, 90, end)], { secrets, now: end });
  assert.ok(atEnd.events.texts.includes("Route position unknown"));
  assert.ok(atEnd.events.texts.includes("ATL → JOUR → TATE → BOYD → COL → ADER → JOE → ATL"));
});

test("no connection gives setup guidance without making a request", async () => {
  const h = harness();
  await h.run(source);
  assert.equal(h.events.requests.length, 0);
  assert.ok(h.events.texts.includes("Setup needed"));
  assert.equal(h.events.complete, 1);
});

test("publishable key uses apikey only; legacy anon uses Bearer too", async () => {
  for (const key of ["sb_publishable_test", "eyJ.test.legacy"]) {
    const h = harness({ secrets: connection(key) });
    await h.run(source);
    assert.equal(h.events.requests[0].headers.apikey, key);
    assert.equal(h.events.requests[0].headers.Authorization, key.startsWith("eyJ") ? "Bearer " + key : undefined);
    assert.ok(h.events.texts.includes("● LIVE"));
    assert.ok(h.events.texts.includes("At: Atlas Athens"));
    assert.equal(h.events.widgets.length, 1);
  }
});

test("bad HTTP, network failure, and empty feed show No Signal", async () => {
  for (const options of [{ status: 403 }, { networkError: true }, { record: [] }]) {
    const h = harness({ secrets: connection(), ...options });
    await h.run(source);
    assert.ok(h.events.texts.includes("No Signal"));
    assert.equal(h.events.complete, 1);
  }
});

test("stale telemetry suppresses ETA; missing timestamp is unverified", async () => {
  const old = harness({ secrets: connection(), record: [{ lat: 33.94, lon: -83.33, recorded_at: "2026-11-16T13:00:00Z" }] });
  await old.run(source);
  assert.ok(old.events.texts.includes("STALE"));
  assert.ok(old.events.texts.includes("ETA unavailable"));
  const missing = harness({ secrets: connection(), record: [{ lat: 33.94, lon: -83.33 }] });
  await missing.run(source);
  assert.ok(missing.events.texts.includes("UNVERIFIED"));
  assert.ok(missing.events.texts.includes("Route position unknown"));
});

test("detour preserves coordinates and follows the passenger stop sequence", async () => {
  const config = harness();
  await config.run(definitions + "globalThis.stops = STOPS;");
  for (const [stop, coordinates] of Object.entries(STOPS)) {
    const { latitude, longitude } = config.context.stops[stop];
    assert.deepEqual([latitude, longitude], coordinates);
  }
  const names = [
    ["ATL", "Atlas Athens"], ["JOUR", "Journalism"], ["TATE", "Tate"],
    ["BOYD", "Boyd"], ["COL", "Coliseum"], ["ADER", "Aderhold"], ["JOE", "Joe Frank"],
  ];
  for (const [index, [stop, name]] of names.entries()) {
    const h = await widgetFor([fix(stop, -60), fix(stop, 0)]);
    assert.ok(h.events.texts.includes("At: " + name));
    assert.ok(h.events.texts.includes("Next: " + names[(index + 1) % names.length][1]));
    assert.ok(h.events.texts.includes("ATL → JOUR → TATE → BOYD → COL → ADER → JOE → ATL"));
  }
  const formerStop = await widgetFor([fix("MAIN", -60), fix("MAIN", 0)]);
  assert.ok(formerStop.events.texts.includes("Route position unknown"));
});

test("both highway legs retain their destinations when passing near other stops", async () => {
  const outbound = await widgetFor([
    fix("ATL", -180), fix("ATL", -120), fix("BOYD", -60, 51), fix("TATE", 0, 38),
  ]);
  assert.ok(outbound.events.texts.includes("Next: Journalism"));
  assert.ok(outbound.events.texts.includes("Highway via Exit 7 · ETA unavailable"));
  assert.ok(!outbound.events.texts.some(text => text.startsWith("At:")));

  const returnTrip = await widgetFor([
    fix("JOE", -210), fix("JOE", -180),
    fix([33.954, -83.374], -120, 24), fix("TATE", -60, 2), fix([33.948, -83.371], 0, 24),
  ]);
  assert.ok(returnTrip.events.texts.includes("Next: Atlas Athens"));
  assert.ok(returnTrip.events.texts.includes("Highway via Exit 8 · ETA unavailable"));

  const geofenceEdge = [STOPS.BOYD[0] + 0.0006, STOPS.BOYD[1]];
  const traffic = await widgetFor([fix("ATL", -180), fix("ATL", -120), fix(geofenceEdge, -60), fix(geofenceEdge, 0)]);
  assert.ok(traffic.events.texts.includes("Next: Journalism"));
});

test("returning to Atlas needs a visit and advances to Journalism on the new loop", async () => {
  const secrets = connection();
  const returnTrip = await widgetFor([fix("JOE", -180), fix("JOE", -120), fix("ATL", 0, 32)], { secrets });
  assert.ok(returnTrip.events.texts.includes("Next: Atlas Athens"));
  const firstSlowFix = await widgetFor([fix("ATL", 30)], { secrets, now: NOW + 30000 });
  assert.ok(firstSlowFix.events.texts.includes("Next: Atlas Athens"));
  const arrived = await widgetFor([fix("ATL", 60)], { secrets, now: NOW + 60000 });
  assert.ok(arrived.events.texts.includes("At: Atlas Athens"));
  assert.ok(arrived.events.texts.includes("Next: Journalism"));
  assert.ok(arrived.events.texts.includes("Highway via Exit 7 · ETA unavailable"));
});

test("first launch stays unknown for single, repeated, overlapping, or fast observations", async () => {
  const midpoint = STOPS.JOUR.map((coordinate, index) => (coordinate + STOPS.TATE[index]) / 2);
  for (const rows of [
    [fix([33.937, -83.350], 0, 55)],
    [fix("TATE", 0), fix("TATE", 0)],
    [fix("TATE", 0)],
    [fix(midpoint, -60), fix(midpoint, 0)],
    [fix("TATE", -60, 35), fix("TATE", 0, 35)],
  ]) {
    const h = await widgetFor(rows);
    assert.ok(h.events.texts.includes("Route position unknown"));
    assert.ok(h.events.texts.includes("ETA unavailable"));
    assert.ok(!h.events.texts.some(text => text.startsWith("Next:")));
  }
  const secrets = connection();
  await widgetFor([fix("TATE", 0)], { secrets });
  const repeated = await widgetFor([fix("TATE", 0)], { secrets, now: NOW + 30000 });
  assert.ok(repeated.events.texts.includes("Route position unknown"));
  const rapid = await widgetFor([fix("JOUR", -9), fix("JOUR", -6), fix("JOUR", -3), fix("JOUR", 0)]);
  assert.ok(rapid.events.texts.includes("At: Journalism"));
});

test("batched GPS history recovers a short stop between widget refreshes", async () => {
  const secrets = connection();
  await widgetFor([fix("ATL", -240), fix("ATL", -180)], { secrets, now: NOW - 180000 });
  const before = fix([33.954, -83.3733], -120, 16);
  const visit = fix("JOUR", -60, 2);
  const after = fix([33.9497, -83.3733], 0, 12);
  const h = await widgetFor([before, visit, after], { secrets });
  assert.ok(h.events.texts.includes("Next: Tate"));
  assert.ok(!h.events.texts.some(text => text.startsWith("At:")));
});

test("missed stops require new visit evidence and gaps invalidate old progress", async () => {
  const h = await widgetFor([
    fix("ATL", -210), fix("ATL", -180), fix("JOUR", -120, 35),
    fix("BOYD", -60), fix("BOYD", 0),
  ]);
  assert.ok(h.events.texts.includes("At: Boyd"));
  assert.ok(h.events.texts.includes("Next: Coliseum"));
  const gap = await widgetFor([fix("JOE", -480), fix("JOE", -420), fix("TATE", 0)]);
  assert.ok(gap.events.texts.includes("Route position unknown"));
  const secrets = connection();
  await widgetFor([fix("JOE", -960), fix("JOE", -910)], { secrets, now: NOW - 910000 });
  const expired = await widgetFor([-700, -500, -300, -150, 0].map(t => fix("TATE", t, 42)), { secrets });
  assert.ok(expired.events.texts.includes("Route position unknown"));
});

test("restoring the regular profile clears detour progress and reinstates Main Library", async () => {
  const secrets = connection();
  await widgetFor([fix("JOE", -120), fix("JOE", -60)], { secrets });
  const h = harness({ secrets, record: [fix("ATL", 0, 43)] });
  const regular = source.replace('const ACTIVE_ROUTE = "magnolia-detour";', 'const ACTIVE_ROUTE = "regular";');
  await h.run(regular);
  assert.ok(h.events.texts.includes("Route position unknown"));
  assert.ok(h.events.texts.includes("ATL → MAIN → JOUR → TATE → BOYD → COL → ADER → JOE → ATL"));
});

test("out-of-order, future-dated and expired feed responses cannot rewind progress", async () => {
  const secrets = connection();
  await widgetFor([fix("JOE", -60), fix("JOE", 0)], { secrets });
  const saved = new Map(secrets);
  for (const rows of [
    [fix("TATE", -120), fix("TATE", -60)],
    [fix("TATE", 300), fix("TATE", 360)],
    [fix("TATE", -800), fix("TATE", -700)],
  ]) {
    const h = await widgetFor(rows, { secrets });
    assert.ok(h.events.texts.includes("STALE"));
    assert.ok(!h.events.texts.some(text => text.startsWith("Next:")));
    assert.deepEqual(secrets, saved);
  }
  const h = await widgetFor([fix("TATE", 60, 45)], { secrets, now: NOW + 60000 });
  assert.ok(h.events.texts.includes("Next: Atlas Athens"));
});

test("history request expands the single-bus query without changing saved settings and can fall back", async () => {
  const url = "https://example.supabase.co/rest/v1/bus_locations?select=*&bus_id=eq.test&order=recorded_at.desc&limit=1";
  const secrets = connection("sb_publishable_test", url);
  const stored = secrets.get("atlas-shuttle-connection");
  const first = harness({ secrets });
  await first.run(source);
  assert.deepEqual(first.events.requests.map(request => request.url), [url.replace("limit=1", "limit=1000")]);
  assert.equal(secrets.get("atlas-shuttle-connection"), stored);
  const fallback = harness({
    secrets,
    respond: requested => requested === url
      ? { status: 200, data: fix("ATL", 60) }
      : { status: 400, data: { message: "unsupported limit" } },
    now: NOW + 60000,
  });
  await fallback.run(source);
  assert.deepEqual(fallback.events.requests.map(request => request.url), [url.replace("limit=1", "limit=1000"), url]);
  assert.ok(fallback.events.texts.includes("At: Atlas Athens"));
  assert.equal(secrets.get("atlas-shuttle-connection"), stored);
});

function historicalLeg(origin, destination, near, passTime, remaining, heading = 90, now = NOW) {
  return [
    fix(origin, passTime - 120, 0, 90, now), fix(origin, passTime - 60, 0, 90, now),
    fix(near, passTime, 42, heading, now),
    fix(destination, passTime + remaining, 0, 90, now), fix(destination, passTime + remaining + 45, 0, 90, now),
  ];
}

test("night ETAs use comparable Thursday night trips and exclude daytime observations", async () => {
  const now = Date.parse("2026-11-27T05:45:00Z");
  const near = [33.937, -83.355];
  const dayTrip = historicalLeg("ATL", "ARCH", near, -18000, 170, 90, now);
  const nightTrip = historicalLeg("ATL", "ARCH", near, -1350, 190, 90, now);
  const live = [fix("ATL", -120, 0, 90, now), fix("ATL", -60, 0, 90, now), fix(near, 0, 42, 90, now)];
  const emptyHistory = await widgetFor([...dayTrip, ...live], { now });
  assert.ok(emptyHistory.events.texts.includes("ETA unavailable"));
  const fallback = await widgetFor([...dayTrip, ...nightTrip, ...live], { now });
  assert.ok(fallback.events.texts.includes("Next: The Arch"));
  assert.ok(fallback.events.texts.includes("Approx. 2–5 min"));
  const secondNightTrip = historicalLeg("ATL", "ARCH", near, -2700, 185, 90, now);
  const estimate = await widgetFor([...secondNightTrip, ...nightTrip, ...live], { now });
  assert.ok(estimate.events.texts.includes("Approx. 3 min"));
});

test("a directionally matched partial night trace can estimate arrival at a checkpoint", async () => {
  const now = Date.parse("2026-11-27T05:45:00Z");
  const record = (place, offset, speed = 0, heading = 270) => fix(place, offset, speed, heading, now);
  const approach = [
    record(EXIT_8, -1800, 35),
    record(OCONEE_RIVER, -1740, 29),
    record([33.954, -83.373], -1680, 14),
  ];
  const arrival = [record("ARCH", -1620, 1), record("ARCH", -1614)];
  const live = [record("ATL", -120), record("ATL", -60), record(OCONEE_RIVER, 0, 24)];
  const matched = await widgetFor([...approach, ...arrival, ...live], { now });
  assert.ok(matched.events.texts.includes("Near North Oconee River"));
  assert.ok(matched.events.texts.includes("Approx. 1–3 min"));
  const unconfirmed = await widgetFor([...approach, ...live], { now });
  assert.ok(unconfirmed.events.texts.includes("ETA unavailable"));
  const reversed = await widgetFor([
    ...approach, ...arrival, ...live.slice(0, 2), record(OCONEE_RIVER, 0, 24, 90),
  ], { now });
  assert.ok(reversed.events.texts.includes("ETA unavailable"));
});

test("ETAs for both highway legs come from matching completed GPS trips", async () => {
  const near = [33.937, -83.355]; // Synthetic test observation.
  for (const [origin, destination, name, exit] of [
    ["ATL", "JOUR", "Journalism", 7],
    ["JOE", "ATL", "Atlas Athens", 8],
  ]) {
    const h = await widgetFor([
      ...historicalLeg(origin, destination, near, -2700, 170),
      ...historicalLeg(origin, destination, near, -1350, 190),
      fix(origin, -180), fix(origin, -120), fix(near, 0, 35),
    ]);
    assert.ok(h.events.texts.includes("Next: " + name));
    assert.ok(h.events.texts.includes("Highway via Exit " + exit + " · Approx. 3 min"));
  }
});

test("absent, opposite-direction, old-route, distant or conflicting matches leave ETA unavailable", async () => {
  const near = [33.937, -83.355];
  const compatible = historicalLeg("ATL", "JOUR", near, -1350, 190);
  for (const history of [
    [],
    historicalLeg("ATL", "JOUR", near, -2700, 170, 270),
    historicalLeg("ATL", "JOUR", [33.928, -83.361], -2700, 170),
    historicalLeg("ATL", "JOUR", near, -86400, 170),
    [...historicalLeg("ATL", "JOUR", near, -2700, 55), ...compatible],
  ]) {
    const h = await widgetFor([...history, fix("ATL", -120), fix("ATL", -60), fix(near, 0, 45)]);
    assert.ok(h.events.texts.includes("Highway via Exit 7 · ETA unavailable"));
  }
  const slow = await widgetFor([
    ...historicalLeg("ATL", "JOUR", near, -2700, 170),
    ...compatible,
    fix("ATL", -180), fix("ATL", -120), fix(near, -45, 1), fix(near, 0, 1),
  ]);
  assert.ok(slow.events.texts.includes("Highway via Exit 7 · ETA unavailable"));
  const outdated = await widgetFor([
    ...compatible, fix("ATL", -240), fix("ATL", -200), fix(near, -125, 45),
  ]);
  assert.ok(outdated.events.texts.includes("Highway via Exit 7 · ETA unavailable"));
});

test("tracker supports in-app preview and execution through loader's async compiler", async () => {
  const h = harness({ secrets: connection(), inApp: true });
  await h.run("await new (Object.getPrototypeOf(async function(){}).constructor)(" + JSON.stringify(source) + ")();");
  assert.equal(h.events.previews, 1);
  assert.equal(h.events.complete, 1);
});

test("setup stores device connection, can cancel or clear it", async () => {
  const h = harness({ inApp: true, inputs: ["https://example.supabase.co/rest/v1/bus_locations?limit=1", "sb_publishable_test"] });
  await h.run(setup);
  assert.equal(h.secrets.size, 1);
  const cancelled = harness({ inApp: true, secrets: h.secrets, cancel: true });
  await cancelled.run(setup);
  assert.equal(h.secrets.size, 1);
  const cleared = harness({ inApp: true, secrets: h.secrets, inputs: ["", ""] });
  await cleared.run(setup);
  assert.equal(h.secrets.size, 0);
});

test("setup rejects invalid URLs and privileged keys", async () => {
  const serviceRole = "eyJ." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".sig";
  for (const inputs of [
    ["http://example.supabase.co/rest/v1/bus_locations", "sb_publishable_test"],
    ["https://example.supabase.co/rest/v1/bus_locations", "sb_secret_test"],
    ["https://example.supabase.co/rest/v1/bus_locations", serviceRole],
  ]) {
    const h = harness({ inApp: true, inputs });
    await assert.rejects(h.run(setup));
    assert.equal(h.secrets.size, 0);
  }
});
