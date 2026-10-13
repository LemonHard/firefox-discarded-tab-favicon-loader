# V1 architecture

## Purpose

The extension exists to work around a Firefox WebExtension limitation: a discarded tab can be restored with its URL and title, but an extension cannot directly assign the native Firefox tab favicon.

The V1 experiment therefore lets Firefox discover the favicon itself while preventing the real page body and unnecessary resources from being loaded/rendered.

## Scope

V1 is deliberately narrow:

- Firefox only.
- Manual user action.
- Only highlighted tabs in the current window.
- Only tabs where `tab.discarded === true`.
- Sequential processing, one tab at a time.
- No automatic rediscard.
- No telemetry or remote analytics.

## Processing flow

```text
User highlights discarded tabs
        |
        v
browser.tabs.query({
    currentWindow: true,
    highlighted: true
})
        |
        v
filter tab.discarded === true
        |
        v
process first tab
        |
        v
arm tabId
        |
        v
browser.tabs.reload(tabId)
        |
        v
webRequest.onHeadersReceived(main_frame)
        |
        +--> 3xx response
        |       |
        |       +--> do not filter
        |            keep tab armed
        |            allow redirect
        |
        +--> final response
                |
                +--> validate status / Content-Type
                |
                +--> browser.webRequest.filterResponseData(requestId)
                |
                v
          buffer response chunks
                |
                +--> find </head>
                |
                +--> or reach 512 KiB safety limit
                |
                v
          parse original head
                |
                +--> title
                +--> first valid base href for URL resolution only
                +--> favicon link candidates
                |
                v
          discard original markup
                |
                v
          generate minimal synthetic HTML
                |
                v
          filter.write(...)
          filter.close()
                |
                v
          observe / query tab.favIconUrl
                |
                v
          display diagnostics
                |
                v
          disarm tabId
                |
                v
          process next selected tab
```

## Why interception starts at `onHeadersReceived`

The filter must not be attached blindly to the first `main_frame` request because the request can return a redirect.

Typical navigation:

```text
https://site.example/
    -> 302
https://www.site.example/
    -> 302
https://login.site.example/
    -> 200 text/html
```

V1 lets redirect responses pass untouched and only installs `filterResponseData()` on the final response that is eligible for HTML processing.

## Stream handling

The original HTML must never be written to Firefox's renderer.

The extension buffers response data privately until one of these conditions occurs:

1. `</head>` is found.
2. 512 KiB of response data has been observed.
3. The stream fails or closes unexpectedly.

When `</head>` is found:

1. Decode the buffered bytes.
2. Parse only the information needed from the head.
3. Build a brand-new minimal HTML document.
4. Call `filter.write(syntheticHtml)`.
5. Call `filter.close()`.

No original script, stylesheet, preload, prefetch, manifest, iframe, image or body markup is forwarded.

## Safety limit

Maximum buffered response data before finding `</head>`:

```text
512 KiB
```

Failure state:

```text
FAIL: </head> not found before safety limit
```

The exact number of bytes observed by StreamFilter is logged for diagnostics. It must not be presented as exact wire traffic because compression, protocol framing, TLS and cache behavior are outside that measurement.

## Parsing rules

Extract:

- `<title>`
- valid favicon link declarations
- first valid `<base href>`, only to resolve relative URLs

Never copy the original `<base>` into the synthetic document.

Relative favicon URLs are resolved against:

1. a valid original `<base href>`, when present;
2. otherwise the final document URL.

Candidate favicon URLs are restricted to schemes explicitly accepted by the implementation.

## Favicons

V1 should preserve multiple useful favicon candidates instead of prematurely selecting a single icon.

Useful attributes to reconstruct:

- `rel`
- absolute `href`
- `type`
- `sizes`
- `media`

If no favicon declaration exists, V1 may synthesize the conventional fallback:

```text
<origin>/favicon.ico
```

The UI and logs must distinguish:

```text
favicon declaration found
```

from:

```text
Firefox actually populated tab.favIconUrl
```

These are not equivalent.

## Synthetic document

The document is intentionally primitive and dependency-free.

Requirements:

- UTF-8.
- Black background.
- Light text.
- No inline JavaScript.
- No site JavaScript.
- No site CSS.
- No external resource except favicon candidates.
- Existing site CSP is not removed or weakened.
- A normal link is provided to load the original page fully.

The original URL remains available for the reload link.

Because interception is one-shot, a later normal navigation or manual reload must not be filtered again unless the user explicitly starts another operation.

## CSP

V1 does not remove, rewrite or weaken `Content-Security-Policy`.

This means a site's CSP may prevent a discovered favicon from loading. That is a legitimate diagnostic result and should be reported as such rather than bypassed.

## Charset

Implementation order to evaluate during coding/testing:

1. HTTP `Content-Type` charset, when valid.
2. BOM.
3. early HTML charset declaration where practical.
4. UTF-8 fallback.

The chosen charset must be logged during development.

## State machine

The implementation should keep explicit per-tab state rather than infer intent from arbitrary web requests.

Minimum state:

```text
tabId
originalUrl
armed
requestId
startTime
bytesObserved
redirectCount
headFound
faviconCandidates
firefoxFavIconUrl
result
```

A tab must be disarmed after successful interception or terminal failure.

## Failure handling

V1 must fail closed and visibly.

Examples:

- tab disappeared before processing
- selected tab is no longer discarded
- unsupported URL scheme
- final response is not HTML
- safety limit reached
- stream error
- parsing failure
- no favicon declaration
- Firefox did not populate `favIconUrl`

A failure on one tab should be logged and then processing should continue with the next selected tab.

## Critical persistence test

The decisive V1 test is not merely seeing a favicon during the active session.

Test procedure:

1. Select approximately five discarded tabs with missing native favicons.
2. Run the extension.
3. Confirm each tab ends on the synthetic diagnostic page.
4. Confirm title and favicon result.
5. Fully exit Firefox.
6. Restart Firefox with session restoration.
7. Check whether the favicons remain associated with the restored tabs.

Only if this succeeds should automatic rediscard be considered for a later version.

## Not in V1

- automatic scan of all tabs
- automatic rediscard
- parallel processing
- CSP modification
- content scripts injected into original pages
- execution of original page JavaScript
- remote services
- telemetry
- analytics
