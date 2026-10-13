# V1 testing procedure

## 1. Get the development branch

Clone the repository and switch to `dev`:

```bash
git clone https://github.com/LemonHard/firefox-discarded-tab-favicon-loader.git
cd firefox-discarded-tab-favicon-loader
git switch dev
```

Alternatively, download the `dev` branch as a ZIP and extract it.

## 2. Load it temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select the repository's `manifest.json`.
4. In the extension entry, click **Inspect** to keep the extension console open.

Expected startup log:

```text
[discarded-tab-favicon-loader] Background initialized, version 0.2.0-dev.
```

## 3. Prepare the first test

Start small.

1. Choose about 3 to 5 tabs that are really discarded and currently show the grey/default globe.
2. Multi-select those tabs in Firefox so they are highlighted.
3. Do not include normal loaded tabs for the first test.

V1 only processes tabs for which Firefox reports `tab.discarded === true`.

## 4. Trigger the extension

Click the extension toolbar button:

**Load title and favicon for selected discarded tabs**

The tabs are processed strictly one after another.

For each tab the expected flow is:

```text
reload discarded tab
-> follow redirects
-> intercept final main_frame response
-> buffer at most 512 KiB
-> stop when </head> is found
-> extract title/base/favicon declarations
-> replace the page with synthetic HTML
-> let Firefox request only the favicon candidate(s)
-> probe tab.favIconUrl
-> continue with the next selected tab
```

## 5. Expected visible result

Each successfully processed tab should display a black diagnostic page containing at least:

- recovered title
- whether favicon declarations were found
- number of favicon candidates supplied to Firefox
- final URL
- HTTP status
- Content-Type
- charset used for parsing
- response bytes observed by StreamFilter
- redirect count
- processing time
- **Reload full page** link

The text:

```text
Firefox favIconUrl : waiting for Firefox...
```

is expected in this V1 page. The definitive favicon result is currently reported in the extension console and is also directly visible in the Firefox tab icon.

## 6. Console result

A successful tab should end with a log similar to:

```text
Final result for tab ...
favicon: https://site.example/favicon.ico
bytesObserved: ...
elapsedMs: ...
```

If Firefox did not expose a native favicon after 2.5 seconds:

```text
favicon: NOT CONFIRMED
```

This distinction is intentional: finding a favicon declaration and Firefox actually adopting a native tab favicon are separate results.

## 7. Full-page reload test

On one synthetic diagnostic page, click:

**Reload full page**

The real page must load normally.

A normal manual reload/F5 after the one-shot interception should also load the real page normally.

## 8. Critical persistence test

Once the first 3 to 5 tabs work:

1. Note which processed tabs now have a native favicon.
2. Fully exit Firefox.
3. Restart Firefox with session restoration.
4. Do not manually reload those tabs.
5. Check whether the favicons remain present.

This is the decisive V1 result.

If the favicon survives the full Firefox restart, the next development step is automatic rediscard after successful acquisition.

## Known V1 boundaries

- HTTP and HTTPS tabs only.
- Processing is sequential.
- 512 KiB maximum buffered response before `</head>`.
- Site CSP is left untouched.
- Site JavaScript and CSS are never forwarded from the original page.
- If no favicon declaration exists, V1 attempts `/favicon.ico`.
- Non-HTML responses are stopped and reported as unsupported.
- StreamFilter/network errors are logged and processing continues with the next tab.
