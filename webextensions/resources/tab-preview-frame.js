/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

// This is a sub part to show tab preview tooltip.
// See also: /siedbar/tab-preview-tooltip.js

let panel = null;
const windowId = new URL(location.href).searchParams.get('windowId') || null;

// https://searchfox.org/mozilla-central/rev/dfaf02d68a7cb018b6cad7e189f450352e2cde04/browser/themes/shared/tabbrowser/tab-hover-preview.css#5
const BASE_PANEL_WIDTH  = 280;
const BASE_PANEL_HEIGHT = 140;

// -moz-platform @media rules looks unavailable on Web contents...
const isWindows = /^Win/i.test(navigator.platform);
const isLinux = /Linux/i.test(navigator.platform);
const isMac = /^Mac/i.test(navigator.platform);

try{
  const style = document.createElement('style');
  style.setAttribute('type', 'text/css');
  style.textContent = `
    :root {
      --show-hide-animation: opacity 0.1s ease-out;
      --scale: 1; /* Web contents may be zoomed by the user, and we need to cancel the zoom effect. */
      opacity: 1;
      transition: var(--show-hide-animation);
    }

    :root:hover {
      opacity: 0;
    }

    .tab-preview-panel {
      /* https://searchfox.org/mozilla-central/rev/dfaf02d68a7cb018b6cad7e189f450352e2cde04/toolkit/themes/shared/popup.css#11-63 */
      color-scheme: light dark;

      --panel-background: Menu;
      --panel-color: MenuText;
      --panel-padding-block: calc(4px / var(--scale));
      --panel-padding: var(--panel-padding-block) 0;
      --panel-border-radius: calc(4px / var(--scale));
      --panel-border-color: ThreeDShadow;
      --panel-width: initial;

      --panel-shadow-margin: 0px;
      --panel-shadow: 0px 0px var(--panel-shadow-margin) hsla(0,0%,0%,.2);
      -moz-window-input-region-margin: var(--panel-shadow-margin);
      margin: calc(-1 * var(--panel-shadow-margin));

      /* Panel design token theming */
      --background-color-canvas: var(--panel-background);

      /*@media (-moz-platform: linux) {*/
      ${isLinux ? '' : '/*'}
        --panel-border-radius: calc(8px / var(--scale));
        --panel-padding-block: calc(3px / var(--scale));

        @media (prefers-contrast) {
          --panel-border-color: color-mix(in srgb, currentColor 60%, transparent);
        }
      ${isLinux ? '' : '*/'}
      /*}*/

      /*@media (-moz-platform: linux) or (-moz-platform: windows) {*/
      ${isLinux || isWindows ? '' : '/*'}
        --panel-shadow-margin: calc(4px / var(--scale));
      ${isLinux || isWindows ? '' : '*/'}
      /*}*/

      /* On some linux WMs we need to draw square menus because alpha is not available */
      @media /*(-moz-platform: linux) and*/ (not (-moz-gtk-csd-transparency-available)) {
        ${isLinux ? '' : '/*'}
        --panel-shadow-margin: 0px !important;
        --panel-border-radius: 0px !important;
        ${isLinux ? '' : '*/'}
      }

      /*@media (-moz-platform: macos) {*/
      ${isMac ? '' : '/*'}
        appearance: auto;
        -moz-default-appearance: menupopup;
        background-color: Menu;
        --panel-background: none;
        --panel-border-color: transparent;
        --panel-border-radius: calc(6px / var(--scale));
      ${isMac ? '' : '*/'}
      /*}*/

      /* https://searchfox.org/mozilla-central/rev/dfaf02d68a7cb018b6cad7e189f450352e2cde04/browser/themes/shared/tabbrowser/tab-hover-preview.css#5 */
      --panel-width: min(100%, calc(${BASE_PANEL_WIDTH}px / var(--scale)));
      --panel-padding: 0;

      /* https://searchfox.org/mozilla-central/rev/b576bae69c6f3328d2b08108538cbbf535b1b99d/toolkit/themes/shared/global-shared.css#111 */
      /* https://searchfox.org/mozilla-central/rev/b576bae69c6f3328d2b08108538cbbf535b1b99d/browser/themes/shared/browser-colors.css#90 */
      --panel-border-color: light-dark(rgb(240, 240, 244), rgb(82, 82, 94));


      background: var(--panel-background);
      border: var(--panel-border-color) solid calc(1px / var(--scale));
      border-radius: var(--panel-border-radius);
      box-shadow: var(--panel-shadow);
      color: var(--panel-color);
      font: Message-Box;
      left: auto;
      max-width: var(--panel-width);
      opacity: 1;
      overflow: hidden; /* clip the preview with the rounded edges */
      padding: var(--panel-border-radius) 0 0;
      position: fixed;
      right: auto;
      transition: var(--show-hide-animation);
      width: var(--panel-width);
    }

    .tab-preview-title {
      font-size: calc(1em / var(--scale));
      font-weight: bold;
      line-height: 1.5; /* -webkit-line-clamp looks unavailable, so this is a workaround */
      margin: 0 var(--panel-border-radius);
      max-height: 3em; /* -webkit-line-clamp looks unavailable, so this is a workaround */
      overflow: hidden;
      /* text-overflow: ellipsis; */
      -webkit-line-clamp: 2; /* https://searchfox.org/mozilla-central/rev/dfaf02d68a7cb018b6cad7e189f450352e2cde04/browser/themes/shared/tabbrowser/tab-hover-preview.css#15-18 */
    }

    .tab-preview-url {
      font-size: calc(1em / var(--scale));
      margin: 0 var(--panel-border-radius);
      opacity: 0.69; /* https://searchfox.org/mozilla-central/rev/234f91a9d3ebef0d514868701cfb022d5f199cb5/toolkit/themes/shared/design-system/tokens-shared.css#182 */
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tab-preview-image-wrapper {
      border-top: calc(1px / var(--scale)) solid var(--panel-border-color);
      margin-top: 0.25em;
      max-height: calc(var(--panel-width) * ${BASE_PANEL_HEIGHT / BASE_PANEL_WIDTH}); /* use relative value instead of 140px */
      overflow: hidden;
    }

    .tab-preview-image {
      max-width: 100%;
      opacity: 1;
      transition: opacity 0.2s ease-out;
    }
    .tab-preview-panel.updating .tab-preview-image {
      transition: none;
    }

    .blank {
      display: none;
    }

    .hidden,
    .loading {
      opacity: 0;
    }

    .updating {
      visibility: hidden;
    }
  `;
  document.head.appendChild(style);

  let lastTimestamp = 0;
  const onMessage = (message, _sender) => {
    if (windowId &&
        message?.windowId != windowId)
      return;

    //console.log('ON MESSAGE IN IFRAME ', lastTimestamp, message);
    /*
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(message);
    document.body.appendChild(pre);
    */

    switch (message?.type) {
      case 'treestyletab:update-tab-preview':
        if (!panel ||
            panel.dataset.tabId != message.tabId ||
            panel.classList.contains('hidden')) {
          return;
        }
      case 'treestyletab:show-tab-preview':
        if (message.timestamp < lastTimestamp) {
          return Promise.resolve(true);
        }
        lastTimestamp = message.timestamp;
        if (!panel) {
          panel = createPanel();
        }
        updatePanel(message);
        document.documentElement.appendChild(panel);
        panel.classList.remove('hidden');
        return Promise.resolve(true);

      case 'treestyletab:hide-tab-preview':
        if (!panel ||
            (message.tabId &&
             panel.dataset.tabId != message.tabId)) {
          return;
        }

        if (message.timestamp < lastTimestamp) {
          return Promise.resolve(true);
        }
        lastTimestamp = message.timestamp;
        panel.classList.add('hidden');
        return Promise.resolve(true);

      case 'treestyletab:notify-sidebar-closed':
        if (panel) {
          panel.classList.add('hidden');
        }
        break;
    }
  };
  browser.runtime.onMessage.addListener(onMessage);
  window.addEventListener('unload', () => {
    browser.runtime.onMessage.removeListener(onMessage);
  }, { once: true });

  document.documentElement.style.pointerEvents = 'none';

  browser.runtime.sendMessage({
    type: 'treestyletab:tab-preview-frame-loaded',
  });
}
catch (error) {
  console.log('TST Tab Preview Frame fatal error: ', error);
}

function createPanel() {
  const panel = document.createElement('div');
  panel.setAttribute('class', 'tab-preview-panel');
  const title = panel.appendChild(document.createElement('div'));
  title.setAttribute('class', 'tab-preview-title');
  const url = panel.appendChild(document.createElement('div'));
  url.setAttribute('class', 'tab-preview-url');
  const previewWrapper = panel.appendChild(document.createElement('div'));
  previewWrapper.setAttribute('class', 'tab-preview-image-wrapper');
  const preview = previewWrapper.appendChild(document.createElement('img'));
  preview.setAttribute('class', 'tab-preview-image');
  preview.addEventListener('load', () => {
    if (preview.src)
      preview.classList.remove('loading');
  });
  return panel;
}

function updatePanel({ tabId, title, url, hasPreview, previewURL, tabRect, offsetTop, align, scale } = {}) {
  if (!panel)
    return;

  if (previewURL)
    hasPreview = true;

  panel.classList.add('updating');

  // This cancels the zoom effect by the user.
  // We need to calculate the scale with two devicePixelRatio values
  // from both the sidebar and the content area, because all contents
  // of the browser window can be scaled on a high-DPI display by the
  // platform.
  scale = window.devicePixelRatio * (scale || 1);
  document.documentElement.style.setProperty('--scale', scale);
  panel.style.setProperty('--panel-width', `${Math.min(window.innerWidth, BASE_PANEL_WIDTH / scale)}px`);

  panel.dataset.tabId = tabId;

  if (typeof title == 'string') {
    panel.querySelector('.tab-preview-title').textContent = title;
  }

  if (typeof url == 'string') {
    const urlElement = panel.querySelector('.tab-preview-url');
    urlElement.textContent = url;
    urlElement.classList.toggle('blank', !url);
  }

  const previewImage = panel.querySelector('.tab-preview-image');
  if (!hasPreview) { // hide it first
    previewImage.classList.add('blank');
  }
  if (hasPreview == previewImage.classList.contains('blank')) { // mismatched state, let's start loading
    previewImage.classList.toggle('loading', hasPreview);
  }
  previewURL = previewURL || 'data:image/png,';
  if (previewURL != previewImage.src) {
    previewImage.src = previewURL;
  }
  if (hasPreview) { // show it later
    previewImage.classList.remove('blank');
  }

  const completeUpdate = () => {
    if (panel.dataset.tabId != tabId)
      return;

    if (!tabRect) {
      panel.classList.remove('updating');
      return;
    }

    const maxY = window.innerHeight / scale;
    const panelHeight = panel.getBoundingClientRect().height;

    if (windowId) { // in-sidebar
      if (tabRect.top > (window.innerHeight / 2)) {
        panel.style.top = `${Math.min(maxY, tabRect.bottom / scale) - panelHeight - tabRect.height}px`;
      }
      else {
        panel.style.top = `${Math.max(0, tabRect.top / scale) + tabRect.height}px`;
      }

      panel.style.left  = 'var(--panel-shadow-margin)';
      panel.style.right = 'var(--panel-shadow-margin)';
    }
    else { // in-content
      // We need to shift the position with the height of the sidebar header.
      const offsetFromWindowEdge = (window.mozInnerScreenY - window.screenY) * scale;
      const sidebarContentsOffset = (offsetTop - offsetFromWindowEdge) / scale;
      const alignToTopPosition = Math.max(0, tabRect.top / scale) + sidebarContentsOffset;

      if (alignToTopPosition + panelHeight >= maxY) {
        panel.style.top = `${Math.min(maxY, tabRect.bottom / scale) - panelHeight + sidebarContentsOffset}px`;
      }
      else {
        panel.style.top = `${alignToTopPosition}px`;
      }

      if (align == 'left') {
        panel.style.left  = 'var(--panel-shadow-margin)';
        panel.style.right = '';
      }
      else {
        panel.style.left  = '';
        panel.style.right = 'var(--panel-shadow-margin)';
      }
    }

    panel.classList.remove('updating');
  };

  if (!hasPreview) {
    completeUpdate();
    return;
  }

  try {
    const { width, height } = previewURL ?
      getPngDimensionsFromDataUri(previewURL) :
      { width: BASE_PANEL_WIDTH, height: BASE_PANEL_HEIGHT };
    const imageWidth = Math.min(window.innerWidth, Math.min(width, BASE_PANEL_WIDTH) / scale);
    const imageHeight = imageWidth / width * height;
    previewImage.style.width = previewImage.style.maxWidth = `min(100%, ${imageWidth}px)`;
    previewImage.style.height = previewImage.style.maxHeight = `${imageHeight}px`;
    window.requestAnimationFrame(completeUpdate);
    return;
  }
  catch (_error) {
  }

  // failsafe: if it is not a png or failed to get dimensions, use image loader to determine the size.
  previewImage.style.width =
    previewImage.style.height =
    previewImage.style.maxWidth =
    previewImage.style.maxHeight = '';
  previewImage.addEventListener('load', completeUpdate, { once: true });
}

function getPngDimensionsFromDataUri(uri) {
  const base64Data = uri.split(',')[1];
  const binaryData = atob(base64Data);
  const byteArray = new Uint8Array(binaryData.length);
  const requiredScanSize = Math.min(binaryData.length, 23);
  for (let i = 0; i < requiredScanSize; i++) {
    byteArray[i] = binaryData.charCodeAt(i);
  }
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < pngSignature.length; i++) {
    if (byteArray[i] !== pngSignature[i])
      throw new Error('invalid data');
  }
  const width =
    (byteArray[16] << 24) |
    (byteArray[17] << 16) |
    (byteArray[18] << 8) |
    byteArray[19];
  const height =
    (byteArray[20] << 24) |
    (byteArray[21] << 16) |
    (byteArray[22] << 8) |
    byteArray[23];
  return { width, height };
}
