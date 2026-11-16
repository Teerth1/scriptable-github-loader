// Variables used by Scriptable.
// icon-color: gray; icon-glyph: cloud-download-alt;

// Public repositories need no token. See README.md for private repositories.
const GITHUB_OWNER = "Teerth1";
const GITHUB_REPO = "scriptable-github-loader";
const GITHUB_BRANCH = "main";
const DEFAULT_FILE = "example-widget.js";

function repositoryKey() {
  return JSON.stringify([GITHUB_OWNER, GITHUB_REPO]);
}

function validateFile(file) {
  if (typeof file !== "string" || !file.endsWith(".js") ||
      file.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Use a repository-relative JavaScript path, such as widgets/weather.js.");
  }
  return file;
}

function tokenKey() {
  return "github-loader-token:" + repositoryKey();
}

async function configureToken() {
  const alert = new Alert();
  alert.title = "Private repository token";
  alert.message = "Optional: store your own read-only GitHub token in Scriptable Keychain. Leave blank to remove it and use public access.";
  alert.addSecureTextField("GitHub token");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");
  if (await alert.presentAlert() === -1) return;
  const token = alert.textFieldValue(0).trim();
  if (token) Keychain.set(tokenKey(), token);
  else if (Keychain.contains(tokenKey())) Keychain.remove(tokenKey());
}

function cacheFileNameFor(file) {
  // Encode every identity component to avoid cross-repo/branch/path collisions.
  return "github-loader-" +
    encodeURIComponent(JSON.stringify([GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, file])) + ".cache";
}

async function fetchRemoteSource(file) {
  const path = file.split("/").map(encodeURIComponent).join("/");
  const url = "https://api.github.com/repos/" +
    encodeURIComponent(GITHUB_OWNER) + "/" + encodeURIComponent(GITHUB_REPO) +
    "/contents/" + path + "?ref=" + encodeURIComponent(GITHUB_BRANCH);
  const req = new Request(url);
  req.headers = {
    "Accept": "application/vnd.github.raw+json",
    "User-Agent": "Scriptable-GitHub-Loader",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (Keychain.contains(tokenKey())) {
    req.headers.Authorization = "Bearer " + Keychain.get(tokenKey());
  }
  req.timeoutInterval = 10;
  const source = await req.loadString();
  const status = req.response && req.response.statusCode;
  if (!status || status < 200 || status >= 300) {
    throw new Error("GitHub returned HTTP " + (status || "unknown") + ". Check the repository, branch, path, and optional Keychain token.");
  }
  if (!source || !source.trim()) throw new Error("GitHub returned an empty script.");
  const contentType = String((req.response.headers || {})["Content-Type"] ||
    (req.response.headers || {})["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json") || /^\s*</.test(source)) {
    throw new Error("GitHub returned a response other than raw JavaScript.");
  }
  // Compile before caching, so malformed updates do not replace a usable copy.
  compileSource(source);
  return source;
}

function compileSource(source) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(source);
}

function showErrorWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#1c1c1e");
  widget.setPadding(14, 14, 14, 14);
  const title = widget.addText("Loader Error");
  title.font = Font.boldSystemFont(15);
  title.textColor = Color.red();
  widget.addSpacer(4);
  const detail = widget.addText(String(message));
  detail.font = Font.systemFont(11);
  detail.textColor = new Color("#8E8E93");
  detail.minimumScaleFactor = 0.6;
  return widget;
}

async function run() {
  if (!config.runsInWidget) {
    const menu = new Alert();
    menu.title = "GitHub Loader";
    menu.addAction("Run widget");
    menu.addAction("Manage private repository token");
    menu.addCancelAction("Cancel");
    const choice = await menu.presentSheet();
    if (choice !== 0) {
      if (choice === 1) await configureToken();
      Script.complete();
      return;
    }
  }
  const parameter = typeof args.widgetParameter === "string"
    ? args.widgetParameter.trim() : "";
  const targetFile = validateFile(parameter || DEFAULT_FILE);
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.cacheDirectory(), cacheFileNameFor(targetFile));
  let code;
  try {
    code = await fetchRemoteSource(targetFile);
    try {
      fm.writeString(cachePath, code);
    } catch (_) {
      console.warn("[Loader] Could not save the offline cache.");
    }
  } catch (error) {
    console.warn("[Loader] " + error.message);
    if (fm.fileExists(cachePath)) {
      try {
        code = fm.readString(cachePath);
        console.warn("[Loader] Using cached script for " + targetFile);
      } catch (_) {
        console.warn("[Loader] Could not read the offline cache.");
      }
    }
    if (!code) throw new Error("Could not load " + targetFile + ". " + error.message);
  }
  // Target scripts own Script.setWidget(), previews, and Script.complete().
  // Do not retry a cached script after a runtime failure: it may duplicate actions.
  await compileSource(code)();
}

try {
  await run();
} catch (error) {
  const widget = showErrorWidget(error.message || "Unable to run the widget.");
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentSmall();
  Script.complete();
}

