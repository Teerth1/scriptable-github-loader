// Variables used by Scriptable.
// icon-color: blue; icon-glyph: gear;

// Run this script in the Scriptable app, never as a widget.
// Connection details stay on this device. Do not commit them to GitHub.
const SETTINGS_KEY = "atlas-shuttle-connection";
if (config.runsInWidget) throw new Error("Run Setup Bus inside Scriptable.");

const previous = Keychain.contains(SETTINGS_KEY)
  ? JSON.parse(Keychain.get(SETTINGS_KEY)) : {};
const form = new Alert();
form.title = "Set up Atlas bus tracker";
form.message = "Enter your authorized Supabase bus_locations REST URL and publishable (or legacy anon) key. Save empty fields to remove the connection.";
form.addTextField("https://YOUR_PROJECT.supabase.co/rest/v1/bus_locations?...", previous.url || "");
form.addSecureTextField("Publishable or legacy anon key", previous.key || "");
form.addAction("Save");
form.addCancelAction("Cancel");
if (await form.presentAlert() !== -1) {
  const url = form.textFieldValue(0).trim();
  const key = form.textFieldValue(1).trim();
  if (!url && !key) {
    if (Keychain.contains(SETTINGS_KEY)) Keychain.remove(SETTINGS_KEY);
  } else {
    if (!/^https:\/\/[^/?#\s]+\/rest\/v1\/[^\s#]+$/.test(url)) {
      throw new Error("Enter a complete HTTPS Supabase REST URL, including the bus filter and latest-record ordering.");
    }
    if (!key || key.startsWith("sb_secret_")) {
      throw new Error("Use a publishable or legacy anon key, never a secret or service_role key.");
    }
    // Legacy Supabase keys are JWTs. Reject service_role even when pasted by mistake.
    if (key.startsWith("eyJ")) {
      try {
        let payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        payload += "=".repeat((4 - payload.length % 4) % 4);
        const claims = JSON.parse(Data.fromBase64String(payload).toRawString());
        if (claims.role !== "anon") throw new Error("Expected anon role");
      } catch (_) {
        throw new Error("Use a valid legacy anon key, never a service_role key.");
      }
    } else if (!key.startsWith("sb_publishable_")) {
      throw new Error("Use a Supabase publishable or legacy anon key.");
    }
    Keychain.set(SETTINGS_KEY, JSON.stringify({ url, key }));
  }
}
Script.complete();
