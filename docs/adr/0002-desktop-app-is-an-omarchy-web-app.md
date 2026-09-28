# The Desktop app is an Omarchy web app, not a native client

On Omarchy machines Mirai runs as an Omarchy web app (`chromium --app`) that follows the System theme, with a Quickshell bar widget, Omarchy menu entries and Hyprland bindings around it, instead of a Qt/QML or Tauri client. The React app stays the only UI, so every feature ships to the Browser tab, the PWA and the Desktop app at once; the native feel comes from Omarchy's own integration points rather than from a second UI.

## Considered Options

- **Full Qt/QML client** (the omawrite stack): truly native, but every page would be built twice, and the CodeMirror editor, the Content reader, mermaid and HLS video have no cheap QML equivalent.
- **Qt shell with web views for the heavy pages**: still two UIs to keep in sync, for little gain over a plain `--app` window.

## Consequences

- The System theme reaches the page through mirai-agent's reports to the hub, because the page is served by the hub while the theme file lives on each laptop.
- Anything that must work while the window is closed (fleet glance, alert notifications) lives in the bar widget, not in the React app.
- Driving an already open window (Ask mirAI, Go to, notification clicks) goes through the hub over `/ws`, because focusing an existing `--app` window cannot pass it a URL.
