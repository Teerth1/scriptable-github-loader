const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const loader = fs.readFileSync(new URL("../Loader.js", "file://" + __filename), "utf8");
const demo = fs.readFileSync(new URL("../example-widget.js", "file://" + __filename), "utf8");

async function execute(options = {}) {
  const files = options.files || new Map();
  const secrets = options.secrets || new Map();
  const calls = { requests: [], widgets: [], completed: 0, previews: 0, writes: 0, logs: [] };
  const context = {
    args: { widgetParameter: options.file || "" },
    config: { runsInWidget: options.inApp !== true },
    console: { warn: message => calls.logs.push(message) },
    Keychain: {
      contains: key => secrets.has(key), get: key => secrets.get(key),
      set: (key, value) => secrets.set(key, value), remove: key => secrets.delete(key),
    },
    FileManager: { local: () => ({
      cacheDirectory: () => "/cache", joinPath: (a, b) => a + "/" + b,
      fileExists: path => files.has(path), readString: path => files.get(path),
      writeString: (path, value) => {
        if (options.writeFails) throw new Error("disk full");
        calls.writes++;
        files.set(path, value);
      },
    }) },
    Request: class {
      constructor(url) { this.url = url; calls.requests.push(this); }
      async loadString() {
        if (options.offline) throw new Error("Network unavailable");
        this.response = { statusCode: options.status || 200, headers: options.headers || {} };
        return options.source === undefined ? "Script.setWidget('remote'); Script.complete();" : options.source;
      }
    },
    Alert: class {
      addAction() {} addCancelAction() {} addSecureTextField() {}
      async presentSheet() { return options.menuChoice ?? 0; }
      async presentAlert() { return options.cancelToken ? -1 : 0; }
      textFieldValue() { return options.tokenInput || ""; }
    },
    ListWidget: class {
      setPadding() {} addSpacer() {}
      addText(text) { calls.lastText = text; return {}; }
      addDate() { return { applyTimeStyle() {} }; }
      async presentSmall() { calls.previews++; }
    },
    Color: class { static red() {} static white() {} },
    Font: { boldSystemFont() {}, systemFont() {} },
    Script: { setWidget: widget => calls.widgets.push(widget), complete: () => calls.completed++ },
  };
  vm.createContext(context);
  let source = loader;
  if (options.branch) source = source.replace('GITHUB_BRANCH = "main"', 'GITHUB_BRANCH = ' + JSON.stringify(options.branch));
  if (options.repo) source = source.replace('GITHUB_REPO = "scriptable-github-loader"', 'GITHUB_REPO = ' + JSON.stringify(options.repo));
  await vm.runInContext("(async () => {\n" + source + "\n})()", context);
  return { calls, files, secrets };
}

test("public fetch has no Authorization header; executes and caches source", async () => {
  const { calls, files } = await execute();
  assert.equal(calls.requests[0].headers.Authorization, undefined);
  assert.equal(calls.requests[0].timeoutInterval, 10);
  assert.deepEqual(calls.widgets, ["remote"]);
  assert.equal(calls.completed, 1);
  assert.equal(files.size, 1);
});

test("offline, HTTP, empty, HTML, JSON and syntax failures preserve and run cache", async () => {
  const { files } = await execute();
  const cached = [...files.values()][0];
  for (const failure of [
    { offline: true }, { status: 404 }, { status: 401 }, { status: 403 },
    { source: "" }, { source: "<html>Error</html>" },
    { source: '{"message":"Error"}', headers: { "content-type": "application/json" } },
    { source: "const invalid = ;" },
  ]) {
    const { calls } = await execute({ files, ...failure });
    assert.deepEqual(calls.widgets, ["remote"]);
    assert.equal([...files.values()][0], cached);
    assert.equal(calls.writes, 0);
  }
});

test("first-run fetch failure produces an error widget", async () => {
  const { calls } = await execute({ offline: true });
  assert.equal(typeof calls.widgets[0], "object");
  assert.match(calls.lastText, /Could not load/);
  assert.equal(calls.completed, 1);
});

test("private token is read from Keychain and omitted from logs", async () => {
  const secrets = new Map([['github-loader-token:["Teerth1","scriptable-github-loader"]', "test-value"]]);
  const { calls } = await execute({ secrets });
  assert.equal(calls.requests[0].headers.Authorization, "Bearer test-value");
  assert.equal(calls.logs.join("").includes("test-value"), false);
});

test("in-app token menu saves, removes and cancels without fetching", async () => {
  const first = await execute({ inApp: true, menuChoice: 1, tokenInput: "  device-only  " });
  assert.equal([...first.secrets.values()][0], "device-only");
  assert.equal(first.calls.requests.length, 0);
  await execute({ inApp: true, menuChoice: 1, cancelToken: true, secrets: first.secrets });
  assert.equal(first.secrets.size, 1);
  await execute({ inApp: true, menuChoice: 1, secrets: first.secrets });
  assert.equal(first.secrets.size, 0);
});

test("path and branch are encoded; cache identities stay separate", async () => {
  const { calls, files } = await execute({ file: "widgets/my weather.js", branch: "feature/widget" });
  assert.match(calls.requests[0].url, /widgets\/my%20weather\.js\?ref=feature%2Fwidget$/);
  const changedBranch = await execute({ files, file: "widgets/my weather.js", offline: true });
  assert.match(changedBranch.calls.lastText, /Could not load/);
  const changedRepo = await execute({ files, file: "widgets/my weather.js", branch: "feature/widget", repo: "another", offline: true });
  assert.match(changedRepo.calls.lastText, /Could not load/);
});

test("invalid paths never make a request", async () => {
  for (const file of ["../secret.js", "/widget.js", "widgets//test.js", "README.md"]) {
    const { calls } = await execute({ file });
    assert.equal(calls.requests.length, 0);
    assert.match(calls.lastText, /repository-relative/);
  }
});

test("runtime failure shows an error without running a second script", async () => {
  const { files } = await execute();
  const { calls } = await execute({ files, source: "throw new Error('Widget failed');" });
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.widgets.length, 1);
  assert.match(calls.lastText, /Widget failed/);
});

test("cache write failure does not prevent execution", async () => {
  const { calls, files } = await execute({ writeFails: true });
  assert.deepEqual(calls.widgets, ["remote"]);
  assert.equal(files.size, 0);
});

test("demo executes both as a widget and an in-app preview", async () => {
  const widget = await execute({ source: demo });
  assert.equal(widget.calls.widgets.length, 1);
  assert.equal(widget.calls.completed, 1);
  const preview = await execute({ source: demo, inApp: true });
  assert.equal(preview.calls.previews, 1);
  assert.equal(preview.calls.completed, 1);
});
