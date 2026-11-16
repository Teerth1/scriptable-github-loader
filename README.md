# Scriptable GitHub Loader

Run an iPhone or iPad Scriptable widget from a JavaScript file hosted on GitHub. Each time iOS runs the loader, it fetches the current file. If fetching fails, it uses the last downloaded, syntactically valid copy cached on that device.

**Public repositories need no GitHub token.** Private repository tokens are optional and stored in Scriptable Keychain, never in the published JavaScript.

This repository contains the loader and a working demo widget. The Atlas Shuttle Tracker (`script.js`) and classes widget (`brightspace.js`) mentioned in the original loader are **not included**. You can add your own scripts using the instructions below.

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

Use one Loader script for several widgets by giving each widget a different Parameter, such as `script.js` and `brightspace.js`, after uploading those files yourself.

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
node --test tests/loader.test.cjs
```

Tests mock the Scriptable APIs; final device behavior should be checked in Scriptable on iOS.

