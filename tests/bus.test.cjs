const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(new URL("../script.js", "file://" + __filename), "utf8");
const setup = fs.readFileSync(new URL("../setup-bus.js", "file://" + __filename), "utf8");
const definitions = source.slice(0, source.indexOf("const connection = readConnection();"));

function harness(options = {}) {
  const events = { requests: [], texts: [], complete: 0, previews: 0, widgets: [] };
  const secrets = options.secrets || new Map();
  const fixedNow = Date.parse("2026-11-16T15:00:00Z");
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
        this.response = { statusCode: options.status || 200 };
        return options.record || [{ latitude: 33.943026, longitude: -83.338263, speed_mph: 12, recorded_at: "2026-11-16T15:00:00Z" }];
      }
    },
    ListWidget: class {
      constructor() { Object.assign(this, stack()); }
      setPadding() {}
      async presentMedium() { events.previews++; }
    },
    LinearGradient: class {}, Color: class {},
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
function connection(key = "sb_publishable_test") {
  return new Map([["atlas-shuttle-connection", JSON.stringify({ url: "https://example.supabase.co/rest/v1/bus_locations?limit=1", key })]]);
}

test("coordinate parser accepts aliases and rejects corrupt coordinates", async () => {
  const h = harness();
  await h.run(definitions + `
    globalThis.parse = parseCoordinates;
  `);
  for (const record of [null, [], {}, { latitude: "", longitude: 0 }, { lat: "bad", lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }]) {
    assert.equal(h.context.parse(record), null);
  }
  const good = h.context.parse([{ lat: "33.94", lng: "-83.33", speed_mph: -2 }]);
  assert.equal(good.latitude, 33.94);
  assert.equal(good.longitude, -83.33);
  assert.equal(good.speed, 0);
  assert.equal(good.recordedAt, null);
});

test("service clock observes Eastern time, weekdays, and DST", async () => {
  const h = harness();
  await h.run(definitions + "globalThis.offline = isBusOffline; globalThis.times = getNextScheduledTimes;");
  for (const date of ["2026-11-16T11:44:00Z", "2026-11-17T00:00:00Z", "2026-11-21T15:00:00Z"]) {
    assert.equal(h.context.offline(new Date(date)), true);
  }
  assert.equal(h.context.offline(new Date("2026-11-16T11:45:00Z")), false);
  assert.equal(h.context.offline(new Date("2026-07-06T10:45:00Z")), false);
  assert.equal(h.context.offline(new Date("2026-07-06T10:44:00Z")), true);
  assert.deepEqual(Array.from(h.context.times(new Date("2026-11-16T12:00:00Z"))), ["7:15 AM", "8:00 AM", "8:45 AM"]);
  assert.deepEqual(Array.from(h.context.times(new Date("2026-11-21T15:00:00Z"))), ["Weekdays only"]);
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
    assert.ok(h.events.texts.includes("At: ATL"));
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
  assert.ok(old.events.texts.includes("No live ETA available"));
  const missing = harness({ secrets: connection(), record: [{ lat: 33.94, lon: -83.33 }] });
  await missing.run(source);
  assert.ok(missing.events.texts.includes("UNVERIFIED"));
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
