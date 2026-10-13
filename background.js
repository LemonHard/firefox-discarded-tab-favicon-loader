/*
 * Project : firefox-discarded-tab-favicon-loader
 * File    : background.js
 * Version : 0.1.0-dev
 * Goal    : Coordinate manual processing of selected discarded Firefox tabs.
 * Date    : 2026-10-13
 *
 * History:
 *   0.1.0-dev - 2026-10-13 - Initial project skeleton.
 *
 * Notes:
 *   - V1 will process selected discarded tabs sequentially.
 *   - StreamFilter interception is intentionally not implemented in this
 *     initial skeleton; architecture is documented in docs/ARCHITECTURE.md.
 *   - Runtime diagnostics are written to the Firefox extension console.
 */

"use strict";

const LOG_PREFIX = "[discarded-tab-favicon-loader]";

/**
 * Write a structured informational message to the extension console.
 *
 * @param {string} message
 * @param {...unknown} details
 */
function log(message, ...details) {
  console.log(LOG_PREFIX, message, ...details);
}

/**
 * Write a structured error message to the extension console.
 *
 * @param {string} message
 * @param {...unknown} details
 */
function logError(message, ...details) {
  console.error(LOG_PREFIX, message, ...details);
}

/**
 * Return the manually highlighted discarded tabs in the current window.
 *
 * @returns {Promise<browser.tabs.Tab[]>}
 */
async function getSelectedDiscardedTabs() {
  const tabs = await browser.tabs.query({
    currentWindow: true,
    highlighted: true
  });

  return tabs.filter((tab) => tab.discarded === true);
}

/**
 * Initial command handler.
 *
 * V1 StreamFilter processing will be inserted here once the interception
 * state machine is implemented.
 */
async function handleBrowserAction() {
  try {
    const tabs = await getSelectedDiscardedTabs();

    if (tabs.length === 0) {
      log("No selected discarded tabs to process.");
      return;
    }

    log(
      `Selected discarded tabs: ${tabs.length}`,
      tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url
      }))
    );

    // TODO V1:
    // Process tabs one by one:
    //   arm tab -> reload -> follow redirects -> intercept final main_frame
    //   -> parse head -> synthesize document -> confirm favIconUrl.
  } catch (error) {
    logError("Browser action failed.", error);
  }
}

browser.browserAction.onClicked.addListener(handleBrowserAction);

log("Background script initialized.");
