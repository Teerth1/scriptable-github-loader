# Atlas Bus Tracker + Scriptable GitHub Loader

Run an iPhone or iPad Scriptable widget from a JavaScript file hosted on GitHub. Each time iOS runs the loader, it fetches the current file. If fetching fails, it uses the last downloaded, syntactically valid copy cached on that device.

**Public repositories need no GitHub token.** Private repository tokens are optional and stored in Scriptable Keychain, never in the published JavaScript.

This repository includes the **Atlas Shuttle Tracker** ([script.js](script.js)), an on-device connection setup script ([setup-bus.js](setup-bus.js)), the GitHub loader, and a demo widget. The classes widget (`brightspace.js`) is not included.

The tracker needs an authorized bus location feed. No Supabase endpoint, bus identifier, or API key is embedded in this repository. Forking this project does not create a tracking backend or provide access to a shuttle operator’s data.

## Set up the Atlas bus tracker

1. Install [Scriptable](https://scriptable.app/) on your iPhone or iPad.
2. Obtain an **authorized Supabase bus location REST URL** and its **publishable key** (or legacy **anon key**) from your feed administrator. If you operate the backend, find these in your Supabase project’s API settings. Do not use a secret key or `service_role` key. An API key alone does not grant access: the backend must allow the intended reads through its Row Level Security policies.
3. Use a newest-first location query filtered to **one bus**. Existing URLs like this one still work:

   ```text
   https://YOUR_PROJECT.supabase.co/rest/v1/bus_locations?select=latitude,longitude,speed_mph,recorded_at&bus_id=eq.YOUR_BUS_ID&order=recorded_at.desc&limit=1
   ```

   Replace `YOUR_PROJECT` and `YOUR_BUS_ID` with the values supplied by your administrator. The location producer must already be writing records; this project is a client widget, not a GPS collector or backend deployment.
4. Open [setup-bus.js](setup-bus.js), choose **Raw**, and copy it into a new Scriptable script named **Setup Bus**. Run it inside the app. Enter your complete endpoint URL and key, then tap **Save**. The settings are stored in Scriptable Keychain on that device. They are separate from the optional GitHub token.
5. Choose how to run the tracker:
   - **Direct:** Copy [script.js](script.js) into Scriptable as **Atlas Bus** and run it. A medium preview should appear. Add a medium Scriptable Home Screen widget and select **Atlas Bus** as its script. No widget parameter is needed.
   - **Automatic source updates:** Follow the Loader setup below, then set the Home Screen widget’s script to **Loader** and its **Parameter** to `script.js`. Use a **medium** widget for the route and timetable. To preview the tracker in the app through Loader, change `DEFAULT_FILE` in your phone’s Loader script to `"script.js"`, then choose **Run widget**.
6. If you see **Setup needed**, run Setup Bus on the same device. For **No Signal**, check connectivity, the endpoint filter, key permissions, and whether the feed contains a valid record. The tracker fetches whenever Scriptable runs it, including at night and on weekends.

To change the connection, run Setup Bus again. To remove it, clear both fields and save. Do not put connection details in GitHub files or widget parameters. This repository does not publish the connection settings supplied by the original author.

### Location feed format

The endpoint must return a JSON array with the newest record first (or a single object):

```json
[{
  "latitude": 33.943026,
  "longitude": -83.338263,
  "speed_mph": 12,
  "heading": 90,
  "recorded_at": "2026-11-16T15:00:00Z"
}]
```

The parser also accepts `lat`, `lng`/`lon`, or `location.latitude`/`location.longitude`. Supply `recorded_at` with a timezone, `speed_mph` in miles per hour, and optional `heading` in degrees from 0 to less than 360. Missing or invalid speed is treated as unknown. Invalid or missing coordinates in the newest record show **No Signal**. Missing or invalid timestamps show **UNVERIFIED**. The widget shows **STALE** for a location over 10 minutes old, over one minute into the future, or older than the most recent observation already processed on the device.

For the documented single-bus query, the tracker requests up to 1,000 rows by expanding `limit=1` at request time. It retries the original URL if the history request fails. The saved URL and key stay in Scriptable Keychain. Other query shapes can return their own newest-first history. Single-row feeds work with the recent observations collected across runs, so they may take longer to confirm a stop. ETAs require a history response.

### Magnolia Street detour

Atlas Athens → **highway via Exit 7** → Journalism → Tate → Boyd → Coliseum → Aderhold → Joe Frank → **highway via Exit 8** → Atlas Athens.

Main Library is removed from the active route. The remaining stops retain their coordinates and geofence radii. The two exits label the highway legs between passenger stops.

The widget uses the last confirmed stop visit to find the next scheduled stop. It confirms a visit from slow, closely spaced GPS fixes in one stop’s geofence, or from a slow fix near the center with a nearby approach and departure. While tracking a highway leg, the single-fix rule applies only to that leg’s destination. A confirmed later stop can restore progress after a missed visit. The widget shows **Route position unknown** until the feed provides a visit, after a gap of more than four minutes between fixes, or when the last confirmed visit is more than 15 minutes old. Arriving back at Atlas starts a new loop toward Journalism. A small progress snapshot and up to three GPS fixes are saved separately in Scriptable Keychain. A fresh feed response is required to display live progress.

### GPS history estimates and schedule

The Supabase location feed supplies positions and timestamps. The widget shows **Approx. N min** when at least two completed trips between the same consecutive stops have GPS fixes near the moving bus’s current position. It uses the median observed time remaining from those fixes, checks heading when available, and rejects estimates when the samples disagree materially or the latest fix is over two minutes old. **ETA unavailable** appears while the bus is at a stop or whenever the available data is too sparse or ambiguous. Highway estimates use observed trip times and need no exit coordinates or road-distance model.

The detour uses trips recorded from November 19, 2026 at 10:40 PM Eastern onward to keep previous-route travel times out of the estimate. Expect **ETA unavailable** until the database contains enough matching detour trips. The configured history window covers up to seven days within the rows the endpoint returns.

The Atlas timetable uses Monday–Friday, 6:45 AM–7 PM in `America/New_York` and accounts for daylight saving time. Verify the published departure times with the operator. These hours are informational. The widget requests another refresh in 30 seconds, and iOS chooses the actual refresh time.

To end the detour, change `ACTIVE_ROUTE` in [script.js](script.js) from `"magnolia-detour"` to `"regular"`. This restores the Main Library stop and clears the previous route’s progress on the next update. To estimate times on the restored route, set that profile’s `etaHistoryFrom` to the timezone-qualified resumption time. To edit the detour in the future, update its `stops` and `exitsAfter` together and move `etaHistoryFrom` forward to the new route’s effective time.

### Thursday night shuttle

At 9 PM Thursday Eastern, the widget switches to a purple disco theme with 🪩 and 🍾 and displays a 10 PM start notice. At 10 PM, tracking switches to **Atlas Athens → The Arch → Atlas Athens**. The night theme and route extend past midnight and end at 3 AM Friday Eastern by default. Adjust `THURSDAY_NIGHT.fridayEnds` in [script.js](script.js) when the end time is confirmed.

The Arch geofence is centered on the [mapped UGA landmark](https://www.openstreetmap.org/node/4886558902). Check that the shuttle’s actual pickup curb falls within the geofence. The night route confirms stops and estimates travel time using GPS observations from its own service window. iOS applies the theme and route when it next refreshes the widget.

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

Tests mock the Scriptable APIs and replay GPS fixtures for both highway legs, missed updates, stop confirmation, return to Atlas, and the ETA fallback. They also cover Thursday night transitions, daylight saving time, and both directions of the Arch loop. On iPhone, run Loader with `script.js` in the app and check the medium widget. For the detour, confirm that Exit 7 points toward Journalism and Exit 8 points toward Atlas Athens. On Thursday night, confirm that the theme appears at the next refresh after 9 PM and that tracking switches to the Arch loop after 10 PM.

