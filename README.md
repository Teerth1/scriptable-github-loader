# Atlas Bus Tracker + Scriptable GitHub Loader

Run an iPhone or iPad Scriptable widget from a JavaScript file hosted on GitHub. Each time iOS runs the loader, it fetches the current file. If fetching fails, it uses the last downloaded, syntactically valid copy cached on that device.

**Public repositories need no GitHub token.** Private repository tokens are optional and stored in Scriptable Keychain, never in the published JavaScript.

This repository includes the **Atlas Shuttle Tracker** ([script.js](script.js)), an on-device connection setup script ([setup-bus.js](setup-bus.js)), the GitHub loader, and a demo widget. The classes widget (`brightspace.js`) is not included.

The tracker needs an authorized bus location feed. No Supabase endpoint, bus identifier, or API key is embedded in this repository. Forking this project does not create a tracking backend or provide access to a shuttle operator’s data.

## Set up the Atlas bus tracker

1. Install [Scriptable](https://scriptable.app/) on your iPhone or iPad.
2. Obtain an **authorized Supabase bus location REST URL** and its **publishable key** (or legacy **anon key**) from your feed administrator. If you operate the backend, find these in your Supabase project’s API settings. Do not use a secret key or `service_role` key. An API key alone does not grant access: the backend must allow the intended reads through its Row Level Security policies.
3. The endpoint should select the latest location for **one bus**, for example:

   ```text
   https://YOUR_PROJECT.supabase.co/rest/v1/bus_locations?select=latitude,longitude,speed_mph,recorded_at&bus_id=eq.YOUR_BUS_ID&order=recorded_at.desc&limit=1
   ```

   Replace `YOUR_PROJECT` and `YOUR_BUS_ID` with the values supplied by your administrator. The location producer must already be writing records; this project is a client widget, not a GPS collector or backend deployment.
4. Open [setup-bus.js](setup-bus.js), choose **Raw**, and copy it into a new Scriptable script named **Setup Bus**. Run it inside the app. Enter your complete endpoint URL and key, then tap **Save**. The settings are stored in Scriptable Keychain on that device. They are separate from the optional GitHub token.
5. Choose how to run the tracker:
   - **Direct:** Copy [script.js](script.js) into Scriptable as **Atlas Bus** and run it. A medium preview should appear. Add a medium Scriptable Home Screen widget and select **Atlas Bus** as its script. No widget parameter is needed.
   - **Automatic source updates:** Follow the Loader setup below, then set the Home Screen widget’s script to **Loader** and its **Parameter** to `script.js`. Use a **medium** widget for the route and timetable. To preview the tracker in the app through Loader, change `DEFAULT_FILE` in your phone’s Loader script to `"script.js"`, then choose **Run widget**.
6. If you see **Setup needed**, run Setup Bus on the same device. For **No Signal**, check connectivity, the endpoint filter, key permissions, and whether the feed contains a valid record. No Supabase requests are made outside service hours.

To change the connection, run Setup Bus again. To remove it, clear both fields and save. Do not put connection details in GitHub files or widget parameters. This repository does not publish the connection settings supplied by the original author.

### Location feed format

The endpoint must return a JSON array with the newest record first (or a single object):

```json
[{
  "latitude": 33.943026,
  "longitude": -83.338263,
  "speed_mph": 12,
  "recorded_at": "2026-11-16T15:00:00Z"
}]
```

The timestamp above only illustrates the format. The live feed must supply current timestamps with a timezone. The parser also accepts `lat`, `lng`/`lon`, or `location.latitude`/`location.longitude`. Speed is in miles per hour; missing or invalid speed is treated as zero. Invalid or missing coordinates show **No Signal**. Missing/invalid timestamps show **UNVERIFIED**; records older than 10 minutes (or over a minute in the future) show **STALE** and suppress the ETA. There is no offline cache of bus telemetry. The Loader’s cache holds JavaScript source only.

### Route, hours, and ETA limits

The supplied route is ATL → MAIN → JOUR → TATE → BOYD → COL → ADER → JOE → ATL. The widget retains the original coordinates, stop radii, and weekday Atlas departure timetable. Verify the timetable and route with the operator; holidays and service exceptions are not modeled.

Service hours are Monday–Friday, 6:45 AM–7 PM in `America/New_York`, including daylight saving time. `FORCE_ONLINE` defaults to `false`; set it to `true` only for testing outside those hours. The widget requests another refresh in 30 seconds, but iOS chooses the actual refresh time.

ETAs are rough estimates using straight-line distance to the stop after the nearest stop and reported speed, falling back to 5 mph when stationary. The route display assumes forward travel in the listed stop order; it does not infer direction from GPS history or model road travel, traffic, or dwell times. A nearest stop is not always the last stop passed. Treat the result as an approximation, not an official arrival prediction.

To adapt this to another route, edit `ROUTE_STOPS`, `SCHEDULED_TIMES`, `SERVICE_TIME_ZONE`, and the service-hours logic in your own copy of `script.js`, then configure that route’s feed on your device.

## Quick setup: try the demo

1. Install [Scriptable](https://scriptable.app/) on your iPhone or iPad.
2. Open [Loader.js](Loader.js), choose **Raw**, and copy the entire file.
3. In Scriptable, tap **+**, paste the code, and name the script **Loader**.
4. Run it in Scriptable and choose **Run widget**. You should see “Loader is working.”
5. Add a Scriptable widget to your Home Screen. Long-press an empty area, choose **Edit → Add Widget** (or **+**, depending on iOS), search for Scriptable, and add a small widget.
6. Long-press the new widget → **Edit Widget**. Choose **Loader** as the Script. Set **Parameter** to `example-widget.js`.

The defaults point to this repository's public demo. No account or token is required to try it. To control updates yourself, follow the next section.

## Use your own repository and widget

1. Fork this repository, or create a GitHub repository and copy its files into it.
2. Upload your widget JavaScript to your repository, for example `widgets/weather.js`. Keep credentials and personal URLs out of public files.
3. Edit the configuration at the top of the **Loader script on your phone**:

   ```js
   const GITHUB_OWNER = "YOUR_GITHUB_USERNAME";
   const GITHUB_REPO = "YOUR_REPOSITORY_NAME";
   const GITHUB_BRANCH = "main";
   const DEFAULT_FILE = "widgets/weather.js";
   ```

   Use your actual branch name. The default file is used for in-app runs and widgets with an empty Parameter.
4. In the Home Screen widget's **Parameter** field, enter the path to your script: `widgets/weather.js`.
5. Run Loader in the app once while online to confirm the configuration and populate the cache.
6. Commit updates to the selected branch. The loader fetches those updates the next time iOS runs it.

Use one Loader script for several widgets by giving each widget a different Parameter. Use `script.js` for the included Atlas tracker and `example-widget.js` for the demo. Other targets, such as `brightspace.js`, must be added by you.

The parameter must be a repository-relative path ending in `.js`, not a GitHub URL. Paths with empty segments, `.`, or `..` are rejected. Nested paths, spaces, and branch names containing slashes are URL-encoded.

## Optional: private repository access

Skip this section for public repositories.

1. Configure the owner, repository, and branch in your phone's Loader script first.
2. In GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
3. Choose the repository owner as the resource owner, select **Only select repositories**, and choose only the repository you want to load from.
4. Under repository permissions, grant **Contents: Read-only**. Choose an expiration date. Organization repositories may also require administrator approval.
5. Run **Loader** inside Scriptable, choose **Manage private repository token**, paste **your own** token in the secure field, and tap **Save**.
6. Run Loader again and choose **Run widget**.

The token is keyed by owner and repository. Set up a token again if you change those settings. To replace an expired token, use the same menu. To remove it, save an empty field. Removing a token does not clear downloaded source from the cache.

Never paste a token into a source file, README, widget parameter, issue, screenshot, or commit. If a token was exposed, [revoke it in GitHub settings](https://github.com/settings/personal-access-tokens) and create a replacement only if needed. Removing a token from the latest file does not remove it from older commits.

## Writing compatible widgets

See [example-widget.js](example-widget.js) for a complete example. Loaded scripts can use Scriptable globals and top-level `await`. They should:

- Build their own widget and call `Script.setWidget(widget)` when `config.runsInWidget` is true.
- Present a preview when run in the app.
- Call `Script.complete()` when finished.

The loader compiles and runs the source inside an asynchronous function. ES module `import`/`export` syntax is not supported. Additional files are not downloaded automatically. Scripts depending on local modules or assets must arrange those separately. Avoid assuming that the executing script's filename is the downloaded file's name.

## Updates and offline behavior

- iOS controls widget refresh timing. A GitHub push does not immediately refresh the Home Screen. A script can request a refresh time with `widget.refreshAfterDate`, but iOS may delay it.
- Loader itself is copied onto your device. To update the loader's behavior, copy the new Loader.js manually.
- The cache is separate for each owner, repository, branch, and file. The first run needs a working connection and repository access.
- HTTP errors, empty responses, HTML/JSON responses, and JavaScript syntax errors do not overwrite an existing cache.
- A fetched script can still fail at runtime. Runtime failures show a Loader Error and do not trigger a second execution from cache, avoiding duplicated side effects.
- Cached scripts are saved in Scriptable's local cache directory. iOS may purge that directory; offline operation is best effort.
- Public access is subject to GitHub's unauthenticated API rate limits. Multiple widgets or frequent manual runs can hit those limits. Use your own read-only token if necessary.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| HTTP 404 | Owner, repository name, branch, file path and capitalization; private access can also return 404. |
| HTTP 401/403 | Expired or revoked token, permissions, organization approval, or API rate limits. |
| No cached copy | Run once online. Changing repository, branch, or path uses a different cache. |
| Old widget after a push | Wait for iOS to refresh, or run Loader in Scriptable. A failed fetch uses the cache. |
| Demo works but your script fails | Run your script directly in Scriptable first; check dependencies and widget family support. |
| Loader Error | Open Scriptable's logs for the HTTP or compilation error. Verify configuration and token settings. |

## Trust and privacy

Only load code from a repository and branch you trust. Downloaded code executes with Scriptable's capabilities, including access to its Keychain; it can read any tokens you store there. A read-only GitHub token limits GitHub access but does not sandbox a downloaded script.

Private repository source is cached as plain text on-device. Keep personal data and credentials in device configuration or Keychain where practical, and review scripts before running them.

## Development

Node.js 18+ is only needed to run the local mocked tests, not to use the widget:

```sh
node --test tests/*.test.cjs
```

Tests mock the Scriptable APIs; final device behavior should be checked in Scriptable on iOS.

