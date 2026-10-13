# Download only page title and favicon on discarded tabs

Experimental Firefox WebExtension for selected discarded tabs.

The goal is to let Firefox acquire only the page title and favicon without loading the full page body and its heavy resources.

## Why

Firefox WebExtensions can restore/create discarded tabs with a URL and title, but cannot directly set the native tab favicon.

Mozilla bug 1475240 tracks this limitation:

https://bugzilla.mozilla.org/show_bug.cgi?id=1475240

The usual workaround reloads the complete page and discards the tab again. This project experiments with a more surgical Firefox-only approach based on `webRequest.filterResponseData()` / `StreamFilter`.

## V1 goal

For manually selected discarded tabs, processed sequentially:

1. Reload one selected discarded tab.
2. Intercept only its final `main_frame` response.
3. Read only enough HTML to find the end of `<head>`.
4. Extract:
   - `<title>`
   - favicon declarations
   - `<base href>` only for URL resolution
5. Never pass the original page head/body to the renderer.
6. Replace it with a minimal synthetic HTML document containing only the title, favicon declarations and diagnostic information.
7. Leave the synthetic page visible in V1.
8. Close and reopen Firefox to test whether the favicon persists in restored session state.

The persistence test is the critical experiment. Automatic rediscard is intentionally postponed.

## Design constraints

- Firefox-only is acceptable.
- Explicit user action only.
- Only manually selected tabs are processed.
- Sequential processing for easy debugging.
- No telemetry.
- No tracking.
- No remote analytics.
- No execution of site JavaScript.
- No loading of site CSS or body resources.
- Do not modify or remove the site's CSP in V1.
- Keep permissions as small and auditable as practical.

## Current target

Development and first validation target: **Firefox 157**.

The initial implementation uses **Manifest V2** because Firefox still exposes the required response-filtering APIs there with a simpler permission model for this experiment.

## Repository structure

```text
.
├── manifest.json
├── background.js
├── LICENSE
└── docs/
    └── ARCHITECTURE.md
```

## References

- Bug 1475240: https://bugzilla.mozilla.org/show_bug.cgi?id=1475240
- MDN `filterResponseData()`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData
- MDN `StreamFilter`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/StreamFilter
- MDN `StreamFilter.close()`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/StreamFilter/close

## Status

Early experimental development. No release yet.

## License

Mozilla Public License 2.0.
