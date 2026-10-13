/*
 * Project : firefox-discarded-tab-favicon-loader
 * File    : background.js
 * Version : 0.2.0-dev
 * Goal    : Load only the title and favicon metadata of selected discarded tabs.
 * Date    : 2026-10-13
 * History : 0.1.0-dev initial skeleton; 0.2.0-dev functional StreamFilter V1.
 * Logging : Firefox extension console (about:debugging -> Inspect).
 * Dry-run : not applicable; processing requires an explicit toolbar click and
 *           only acts on manually selected discarded tabs.
 */

"use strict";

const VERSION = "0.2.0-dev";
const PREFIX = "[discarded-tab-favicon-loader]";
const HEAD_LIMIT = 512 * 1024;
const REQUEST_TIMEOUT = 30000;
const FAVICON_WAIT = 2500;

let activeJob = null;
let runInProgress = false;

function log(message, data) {
  if (data === undefined) console.log(PREFIX, message);
  else console.log(PREFIX, message, data);
}

function warn(message, data) {
  if (data === undefined) console.warn(PREFIX, message);
  else console.warn(PREFIX, message, data);
}

function error(message, data) {
  if (data === undefined) console.error(PREFIX, message);
  else console.error(PREFIX, message, data);
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) return "";
  name = name.toLowerCase();
  const item = headers.find(function (h) {
    return h && typeof h.name === "string" && h.name.toLowerCase() === name;
  });
  return item && typeof item.value === "string" ? item.value : "";
}

function parseCharset(contentType) {
  const match = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType || "");
  return match ? match[1] : "";
}

function chooseCharset(bytes, httpCharset) {
  const candidates = [];
  if (httpCharset) candidates.push(httpCharset);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) candidates.push("utf-8");
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) candidates.push("utf-16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) candidates.push("utf-16be");

  try {
    const sample = new TextDecoder("windows-1252").decode(bytes.subarray(0, Math.min(bytes.length, 16384)));
    const meta = /<meta\s+[^>]*charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(sample);
    if (meta) candidates.push(meta[1]);
  } catch (_ignored) {}

  candidates.push("utf-8");

  for (const label of candidates) {
    try {
      return new TextDecoder(label).encoding;
    } catch (_ignored) {
      warn("Unsupported charset ignored: " + label);
    }
  }
  return "utf-8";
}

function concatChunks(chunks, length) {
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return all;
}

function appendChunk(job, arrayBuffer) {
  const incoming = new Uint8Array(arrayBuffer);
  job.bytesObserved += incoming.byteLength;
  const remaining = HEAD_LIMIT - job.bytesBuffered;
  if (remaining <= 0) return;
  const part = incoming.subarray(0, Math.min(remaining, incoming.byteLength));
  const copy = new Uint8Array(part.byteLength);
  copy.set(part);
  job.chunks.push(copy);
  job.bytesBuffered += copy.byteLength;
}

function decodeHead(job) {
  const bytes = concatChunks(job.chunks, job.bytesBuffered);
  job.charset = chooseCharset(bytes, job.httpCharset);
  try {
    return new TextDecoder(job.charset).decode(bytes);
  } catch (_ignored) {
    job.charset = "utf-8";
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function escapeHtml(value) {
  let out = "";
  for (const ch of String(value == null ? "" : value)) {
    const cp = ch.codePointAt(0);
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === "\"") out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else out += "&#x" + cp.toString(16) + ";";
  }
  return out;
}

function resolveUrl(raw, base, icon) {
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    if (icon) {
      if (!["http:", "https:", "data:"].includes(url.protocol)) return null;
      if (url.protocol === "data:" && !/^data:image\//i.test(url.href)) return null;
    } else if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch (_ignored) {
    return null;
  }
}

function extractHead(html, finalUrl) {
  const match = /<\/head\s*>/i.exec(html);
  if (!match) return null;
  const headHtml = html.slice(0, match.index + match[0].length);
  const doc = new DOMParser().parseFromString(headHtml, "text/html");
  const titleNode = doc.querySelector("title");
  const title = titleNode ? titleNode.textContent.trim() : "";

  let base = finalUrl;
  const baseNode = doc.querySelector("base[href]");
  if (baseNode) base = resolveUrl(baseNode.getAttribute("href"), finalUrl, false) || finalUrl;

  const icons = [];
  const seen = new Set();
  for (const link of doc.querySelectorAll("link[rel][href]")) {
    const rel = (link.getAttribute("rel") || "").trim();
    if (!rel.toLowerCase().includes("icon")) continue;
    const href = resolveUrl(link.getAttribute("href"), base, true);
    if (!href) continue;
    const key = rel.toLowerCase() + "\n" + href;
    if (seen.has(key)) continue;
    seen.add(key);
    icons.push({
      rel: rel,
      href: href,
      type: (link.getAttribute("type") || "").trim(),
      sizes: (link.getAttribute("sizes") || "").trim(),
      media: (link.getAttribute("media") || "").trim()
    });
  }
  return { title: title, icons: icons };
}

function fallbackIcon(finalUrl) {
  try {
    const url = new URL(finalUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return { rel: "icon", href: new URL("/favicon.ico", url).href, type: "", sizes: "", media: "" };
  } catch (_ignored) {
    return null;
  }
}

function iconLinks(icons) {
  return icons.map(function (icon) {
    const attrs = ["rel=\"" + escapeHtml(icon.rel) + "\"", "href=\"" + escapeHtml(icon.href) + "\""];
    if (icon.type) attrs.push("type=\"" + escapeHtml(icon.type) + "\"");
    if (icon.sizes) attrs.push("sizes=\"" + escapeHtml(icon.sizes) + "\"");
    if (icon.media) attrs.push("media=\"" + escapeHtml(icon.media) + "\"");
    return "<link " + attrs.join(" ") + ">";
  }).join("\n");
}

function syntheticHtml(job, result) {
  const title = result.title || job.originalTitle || "Discarded tab";
  let faviconState;
  if (result.declarationFound) faviconState = "favicon declaration found";
  else if (result.icons.length) faviconState = "no declaration; /favicon.ico fallback inserted";
  else faviconState = "no declaration and no usable fallback";

  const pageState = result.ok ? "Full page loading was stopped." : "FAIL: " + result.error;
  const reloadUrl = job.finalUrl || job.originalUrl;

  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><title>" + escapeHtml(title) + "</title>",
    iconLinks(result.icons),
    "</head><body bgcolor=\"#000000\" text=\"#ffffff\" link=\"#80bfff\" vlink=\"#80bfff\"><pre>",
    "Download only page title and favicon on discarded tabs\n\n",
    "Title\n------------------------------------------------------------\n" + escapeHtml(title) + "\n\n",
    "Favicon\n------------------------------------------------------------\n" + escapeHtml(faviconState) + "\n",
    "Candidates supplied to Firefox : " + result.icons.length + "\n",
    "Firefox favIconUrl              : waiting for Firefox...\n\n",
    "Page\n------------------------------------------------------------\n" + escapeHtml(pageState) + "\n",
    "Final URL                       : " + escapeHtml(reloadUrl) + "\n",
    "HTTP status                     : " + escapeHtml(job.statusCode || "unknown") + "\n",
    "Content-Type                    : " + escapeHtml(job.contentType || "not supplied") + "\n",
    "Charset used to parse head      : " + escapeHtml(job.charset || "not applicable") + "\n",
    "Response bytes observed         : " + job.bytesObserved + "\n",
    "Redirects observed              : " + job.redirectCount + "\n",
    "Processing time                 : " + (Date.now() - job.startTime) + " ms\n\n",
    "<a href=\"" + escapeHtml(reloadUrl) + "\">Reload full page</a>",
    "</pre></body></html>"
  ].join("");
}

function finishJob(job, result) {
  if (job.done) return;
  job.done = true;
  clearTimeout(job.timeoutId);
  if (activeJob === job) activeJob = null;
  job.resolve(result);
}

async function probeFavicon(job) {
  const end = Date.now() + FAVICON_WAIT;
  while (!job.done && !job.firefoxFavIconUrl && Date.now() < end) {
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  if (!job.done && !job.firefoxFavIconUrl) {
    try {
      const tab = await browser.tabs.get(job.tabId);
      job.firefoxFavIconUrl = tab.favIconUrl || "";
    } catch (ex) {
      warn("Unable to query final tab state " + job.tabId, ex);
    }
  }
  if (!job.done) {
    const result = Object.assign({}, job.result || {}, { firefoxFavIconUrl: job.firefoxFavIconUrl || "" });
    log("Final result for tab " + job.tabId, {
      favicon: result.firefoxFavIconUrl || "NOT CONFIRMED",
      bytesObserved: job.bytesObserved,
      elapsedMs: Date.now() - job.startTime
    });
    finishJob(job, result);
  }
}

function writeSynthetic(job, result) {
  if (job.finalized || !job.filter) return;
  job.finalized = true;
  job.result = result;
  try {
    job.filter.write(new TextEncoder().encode(syntheticHtml(job, result)));
    job.filter.close();
    log("Synthetic response written for tab " + job.tabId, {
      url: job.finalUrl,
      status: job.statusCode,
      bytesObserved: job.bytesObserved,
      bytesBuffered: job.bytesBuffered,
      charset: job.charset,
      redirects: job.redirectCount,
      faviconCandidates: result.icons.length
    });
    void probeFavicon(job);
  } catch (ex) {
    error("Failed to write synthetic response for tab " + job.tabId, ex);
    finishJob(job, { ok: false, error: String(ex) });
  }
}

function failStream(job, message) {
  writeSynthetic(job, {
    ok: false,
    error: message,
    title: job.originalTitle || "Discarded tab",
    icons: [],
    declarationFound: false
  });
}

function tryFinalize(job) {
  const decoded = decodeHead(job);
  if (!/<\/head\s*>/i.test(decoded)) return false;

  let data;
  try {
    data = extractHead(decoded, job.finalUrl);
  } catch (ex) {
    failStream(job, "head parsing failed: " + String(ex));
    return true;
  }
  if (!data) return false;

  const declarationFound = data.icons.length > 0;
  const icons = data.icons.slice();
  if (!icons.length) {
    const fallback = fallbackIcon(job.finalUrl);
    if (fallback) icons.push(fallback);
  }

  writeSynthetic(job, {
    ok: true,
    error: "",
    title: data.title || job.originalTitle || "Discarded tab",
    icons: icons,
    declarationFound: declarationFound
  });
  return true;
}

function attachFilter(job, details) {
  job.requestId = details.requestId;
  job.finalUrl = details.url;
  job.statusCode = details.statusCode;
  job.contentType = getHeader(details.responseHeaders, "content-type");
  job.httpCharset = parseCharset(job.contentType);
  const mime = (job.contentType.split(";", 1)[0] || "").trim().toLowerCase();
  job.isHtml = !mime || mime === "text/html" || mime === "application/xhtml+xml";

  try {
    job.filter = browser.webRequest.filterResponseData(details.requestId);
  } catch (ex) {
    finishJob(job, { ok: false, error: "filterResponseData failed: " + String(ex) });
    return;
  }

  job.filter.onstart = function () {
    if (!job.isHtml) failStream(job, "unsupported Content-Type: " + (job.contentType || "not supplied"));
  };

  job.filter.ondata = function (event) {
    if (job.finalized) return;
    appendChunk(job, event.data);
    if (tryFinalize(job)) return;
    if (job.bytesBuffered >= HEAD_LIMIT) failStream(job, "</head> not found before 512 KiB safety limit");
  };

  job.filter.onstop = function () {
    if (job.finalized) return;
    if (job.bytesBuffered && tryFinalize(job)) return;
    failStream(job, "response ended before </head> was found");
  };

  job.filter.onerror = function () {
    const message = job.filter.error || "unknown StreamFilter error";
    error("StreamFilter error for tab " + job.tabId + ": " + message);
    finishJob(job, { ok: false, error: "StreamFilter error: " + message });
  };

  log("Filtering final response for tab " + job.tabId, {
    url: details.url,
    status: details.statusCode,
    contentType: job.contentType || "not supplied"
  });
}

function onHeadersReceived(details) {
  const job = activeJob;
  if (!job || job.done || details.tabId !== job.tabId) return {};

  if (details.statusCode >= 300 && details.statusCode < 400 && details.statusCode !== 304) {
    job.redirectCount += 1;
    job.finalUrl = details.url;
    log("Redirect for tab " + job.tabId + ": HTTP " + details.statusCode, details.url);
    return {};
  }

  if (!job.filter) attachFilter(job, details);
  return {};
}

function onTabUpdated(tabId, changeInfo) {
  const job = activeJob;
  if (job && !job.done && tabId === job.tabId && changeInfo.favIconUrl) {
    job.firefoxFavIconUrl = changeInfo.favIconUrl;
    log("Firefox reported favIconUrl for tab " + tabId, changeInfo.favIconUrl);
  }
}

async function processTab(tab) {
  let current;
  try {
    current = await browser.tabs.get(tab.id);
  } catch (ex) {
    return { ok: false, error: "tab disappeared: " + String(ex) };
  }
  if (!current.discarded) return { ok: false, error: "tab is no longer discarded" };

  let parsed;
  try { parsed = new URL(current.url); }
  catch (_ignored) { return { ok: false, error: "invalid URL: " + current.url }; }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "unsupported URL scheme: " + parsed.protocol };
  }

  const resultPromise = new Promise(function (resolve) {
    const job = {
      tabId: current.id,
      originalUrl: current.url,
      originalTitle: current.title || "",
      finalUrl: current.url,
      startTime: Date.now(),
      redirectCount: 0,
      requestId: "",
      statusCode: 0,
      contentType: "",
      httpCharset: "",
      charset: "",
      isHtml: false,
      chunks: [],
      bytesObserved: 0,
      bytesBuffered: 0,
      filter: null,
      finalized: false,
      firefoxFavIconUrl: "",
      result: null,
      done: false,
      timeoutId: null,
      resolve: resolve
    };
    job.timeoutId = setTimeout(function () {
      error("Timeout while processing tab " + job.tabId);
      finishJob(job, { ok: false, error: "timeout after 30000 ms" });
    }, REQUEST_TIMEOUT);
    activeJob = job;
  });

  log("Reloading discarded tab " + current.id, { title: current.title, url: current.url });
  try {
    await browser.tabs.reload(current.id);
  } catch (ex) {
    if (activeJob && activeJob.tabId === current.id) {
      finishJob(activeJob, { ok: false, error: "tabs.reload failed: " + String(ex) });
    }
  }
  return resultPromise;
}

async function selectedDiscardedTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true, highlighted: true });
  return tabs.filter(function (tab) { return tab.discarded === true; });
}

async function run() {
  if (runInProgress) {
    warn("A processing run is already in progress.");
    return;
  }
  runInProgress = true;
  try {
    const tabs = await selectedDiscardedTabs();
    if (!tabs.length) {
      log("No selected discarded tabs to process.");
      return;
    }
    log("Starting sequential run for " + tabs.length + " tab(s), version " + VERSION);
    const summary = [];
    for (const tab of tabs) {
      const result = await processTab(tab);
      summary.push({ tabId: tab.id, url: tab.url, ok: Boolean(result.ok), error: result.error || "", favicon: result.firefoxFavIconUrl || "" });
    }
    log("Sequential run completed.", summary);
  } catch (ex) {
    error("Run failed.", ex);
  } finally {
    runInProgress = false;
    activeJob = null;
  }
}

browser.webRequest.onHeadersReceived.addListener(
  onHeadersReceived,
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
  ["blocking", "responseHeaders"]
);
browser.tabs.onUpdated.addListener(onTabUpdated);
browser.browserAction.onClicked.addListener(run);

log("Background initialized, version " + VERSION + ".");
