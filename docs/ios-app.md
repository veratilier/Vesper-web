# Vesper iOS

The iOS target is a Capacitor shell around the existing production Vesper app.
The app connects to the existing Cloudflare and VPS services. Its WebView has
separate local storage and cookies from Safari/PWA: sign in or pair the device
again on first launch. Server-synced data can be retrieved after authentication;
PWA-only settings and unsynced records do not migrate automatically.

## First install on a Mac

```bash
git pull --ff-only origin sites-release-ca9c513
npm ci
npm run ios:sync
npm run ios:open
```

In Xcode:

1. Select the `App` project, then **Signing & Capabilities**.
2. Choose your Apple account under **Team**. Keep the bundle identifier
   `com.rvera.vesper`, or change it if Xcode reports that it is unavailable.
3. Connect the iPhone, select it as the run destination, and press Run.
4. If iOS asks, enable Developer Mode and trust the developer profile.

The first native version loads `https://vesper.r-vera.com` inside its own
WKWebView. The status bar overlays the web view and the native container controls
safe-area behavior. The existing web opening animation still runs after launch.

## After native configuration changes

Run `npm run ios:sync`, then build again in Xcode. Ordinary Vesper web releases
continue to arrive from the production URL without rebuilding the iOS shell.

## Current scope

- iPhone and iPad Xcode project
- Existing Vesper login, chat, media, music, and Cloudflare/VPS services
- Edge-to-edge web view with native status-bar handling
- Existing Vesper icon and a neutral launch screen

Native push notifications, HealthKit, widgets, and background tasks are separate
follow-up integrations and require their own Apple capabilities and server paths.

## Verification boundary

Web build and Capacitor sync have passed. Xcode compilation, device signing,
safe-area rendering, login, microphone, media playback, and file flows still
require testing on a Mac and iPhone. This is a native shell using the existing
web UI, not a SwiftUI rewrite.
