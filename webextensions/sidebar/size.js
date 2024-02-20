/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import EventListenerManager from '/extlib/EventListenerManager.js';

import {
  log as internalLogger,
  configs
} from '/common/common.js';

function log(...args) {
  internalLogger('sidebar/size', ...args);
}

export const onUpdated = new EventListenerManager();

let mTabHeight          = 0;
let mTabXOffset         = 0;
let mTabYOffset         = 0;
let mFavIconSize        = 0;
let mFavIconizedTabSize = 0;

export function getTabHeight() {
  return mTabHeight;
}

export function getTabXOffset() {
  return mTabXOffset;
}

export function getTabYOffset() {
  return mTabYOffset;
}

export function getFavIconSize() {
  return mFavIconSize;
}

export function getFavIconizedTabSize() {
  return mFavIconizedTabSize;
}

export function init() {
  update();
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addListener(update);
}

export function update() {
  // first, calculate actual favicon size.
  mFavIconSize = document.querySelector('#dummy-favicon-size-box').getBoundingClientRect().height;
  const scale = Math.max(configs.faviconizedTabScale, 1);
  mFavIconizedTabSize = parseInt(mFavIconSize * scale);
  log('mFavIconSize / mFavIconizedTabSize ', mFavIconSize, mFavIconizedTabSize);
  let sizeDefinition = `:root {
    --favicon-size:         ${mFavIconSize}px;
    --faviconized-tab-size: ${mFavIconizedTabSize}px;
  }`;

  const dummyTab = document.querySelector('#dummy-tab');
  const dummyTabRect = dummyTab.getBoundingClientRect();
  mTabHeight = dummyTabRect.height;
  const style  = window.getComputedStyle(dummyTab);
  mTabXOffset = parseFloat(style.marginLeft.replace(/px$/, '')) + parseFloat(style.marginRight.replace(/px$/, ''));
  mTabYOffset = parseFloat(style.marginTop.replace(/px$/, '')) + parseFloat(style.marginBottom.replace(/px$/, ''));

  const substanceRect = dummyTab.querySelector('tab-item-substance').getBoundingClientRect();
  const uiRect = dummyTab.querySelector('tab-item-substance > .ui').getBoundingClientRect();
  const captionRect = dummyTab.querySelector('tab-item-substance > .ui > .caption').getBoundingClientRect();
  const favIconRect = dummyTab.querySelector('tab-favicon').getBoundingClientRect();
  const labelRect = dummyTab.querySelector('tab-label').getBoundingClientRect();
  const closeBoxRect = dummyTab.querySelector('tab-closebox').getBoundingClientRect();

  let shiftTabsForScrollbarDistance = configs.shiftTabsForScrollbarDistance.trim() || '0';
  if (!/^[0-9\.]+(cm|mm|Q|in|pc|pt|px|em|ex|ch|rem|lh|vw|vh|vmin|vmax|%)$/.test(shiftTabsForScrollbarDistance))
    shiftTabsForScrollbarDistance = '0'; // ignore invalid length
  if (shiftTabsForScrollbarDistance == '0')
    shiftTabsForScrollbarDistance += 'px'; // it is used with CSS calc() and it requires any length unit for each value.

  log('mTabHeight ', mTabHeight);
  const baseLeft  = substanceRect.left;
  const baseRight = substanceRect.right;
  sizeDefinition += `:root {
    --tab-size: ${mTabHeight}px;
    --tab-substance-size: ${substanceRect.height}px;
    --tab-ui-size: ${uiRect.height}px;
    --tab-caption-size: ${captionRect.height}px;
    --tab-x-offset: ${mTabXOffset}px;
    --tab-y-offset: ${mTabYOffset}px;
    --tab-height: var(--tab-size); /* for backward compatibility of custom user styles */
    --tab-favicon-start-offset: ${favIconRect.left - baseLeft}px;
    --tab-favicon-end-offset: ${baseRight - favIconRect.right}px;
    --tab-label-start-offset: ${labelRect.left - baseLeft}px;
    --tab-label-end-offset: ${baseRight - labelRect.right}px;
    --tab-closebox-start-offset: ${closeBoxRect.left - baseLeft}px;
    --tab-closebox-end-offset: ${baseRight - closeBoxRect.right}px;

    --tab-burst-duration: ${configs.burstDuration}ms;
    --indent-duration:    ${configs.indentDuration}ms;
    --collapse-duration:  ${configs.collapseDuration}ms;
    --out-of-view-tab-notify-duration: ${configs.outOfViewTabNotifyDuration}ms;
    --visual-gap-hover-animation-delay: ${configs.cancelGapSuppresserHoverDelay}ms;

    --shift-tabs-for-scrollbar-distance: ${shiftTabsForScrollbarDistance};
  }`;

  const sizeDefinitionHolder = document.querySelector('#size-definition');
  if (sizeDefinitionHolder.textContent == sizeDefinition)
    return;

  sizeDefinitionHolder.textContent = sizeDefinition
  onUpdated.dispatch();
}

export function calc(expression) {
  expression = expression.replace(/^\s*calc\((.+)\)\s*$/, '$1');
  const box = document.createElement('span');
  const style = box.style;
  style.display       = 'inline-block';
  style.left          = 0;
  style.height        = 0;
  style.overflow      = 'hidden';
  style.pointerEvents = 'none';
  style.position      = 'fixed';
  style.top           = 0;
  style.zIndex        = 0;

  const innerBox = box.appendChild(document.createElement('span'));
  const innerStyle = innerBox.style;
  innerStyle.display       = 'inline-block';
  innerStyle.left          = 0;
  innerStyle.height        = 0;
  innerStyle.pointerEvents = 'none';
  innerStyle.position      = 'fixed';
  innerStyle.top           = `calc(${expression})`;
  innerStyle.zIndex        = 0;

  document.body.appendChild(box);
  const result = innerBox.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.parentNode.removeChild(box);
  return result;
}
