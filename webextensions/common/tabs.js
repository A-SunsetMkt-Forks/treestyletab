/* ***** BEGIN LICENSE BLOCK ***** 
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Tree Style Tab.
 *
 * The Initial Developer of the Original Code is YUKI "Piro" Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2011-2017
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s): YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
 *                 wanabe <https://github.com/wanabe>
 *                 Tetsuharu OHZEKI <https://github.com/saneyuki>
 *                 Xidorn Quan <https://github.com/upsuper> (Firefox 40+ support)
 *                 lv7777 (https://github.com/lv7777)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ******/
'use strict';

import * as Constants from './constants.js';
import * as ApiTabs from './api-tabs.js';
import {
  log as internalLogger,
  configs
} from './common.js';

import EventListenerManager from '/extlib/EventListenerManager.js';

function log(...args) {
  internalLogger('common/tabs', ...args);
}


let mTargetWindow;

export const allTabsContainer = document.querySelector('#all-tabs');


export const trackedWindows = new Map();
export const trackedTabs = new Map();
export const trackedTabsByUniqueId = new Map();
export const activeTabForWindow = new Map();
export const highlightedTabsForWindow = new Map();

export function track(apiTab) {
  apiTab.$TSTStates = {};
  apiTab.$TSTAttributes = {};
  trackedTabs.set(apiTab.id, apiTab);
  let window = trackedWindows.get(apiTab.windowId);
  if (!window) {
    window = {
      id:    apiTab.windowId,
      tabs:  new Map(),
      getOrderedTabs(startId) {
        let order = this.order;
        if (startId) {
          if (!this.tabs.has(startId))
            return [];
          order = order.slice(order.indexOf(startId));
        }
        return (function*() {
          for (const id of order) {
            yield this.tabs.get(id);
          }
        }).call(this);
      },
      getReversedOrderedTabs(startId) {
        let order = this.order.slice(0).reverse();
        if (startId) {
          if (!this.tabs.has(startId))
            return [];
          order = order.slice(order.indexOf(startId));
        }
        return (function*() {
          for (const id of order) {
            yield this.tabs.get(id);
          }
        }).call(this);
      },
      order: []
    };
    trackedWindows.set(apiTab.windowId, window);
    highlightedTabsForWindow.set(apiTab.windowId, new Set());
  }
  if (window.tabs.has(apiTab.id)) { // already tracked: update
    const index = window.order.indexOf(apiTab.id);
    window.order.splice(index, 1);
    window.order.splice(apiTab.index, 0, apiTab.id);
    for (let i = Math.min(index, apiTab.index), maxi = Math.max(index, apiTab.index) + 1; i < maxi; i++) {
      window.tabs.get(window.order[i]).index = i;
    }
  }
  else { // not tracked yet: add
    window.tabs.set(apiTab.id, apiTab);
    window.order.splice(apiTab.index, 0, apiTab.id);
    for (let i = apiTab.index + 1, maxi = window.order.length; i < maxi; i++) {
      window.tabs.get(window.order[i]).index = i;
    }
  }
}

export function untrack(apiTabId) {
  const apiTab = trackedTabs.get(apiTabId);
  const window = trackedWindows.get(apiTab.windowId);
  if (window) {
    window.tabs.delete(apiTabId);
    const index = window.order.indexOf(apiTab.id);
    window.order.splice(index, 1);
    if (window.tabs.size == 0) {
      trackedWindows.delete(apiTab.windowId, window);
    }
    else {
      for (let i = index, maxi = window.order.length; i < maxi; i++) {
        window.tabs.get(window.order[i]).index = i;
      }
    }
  }
}

export function untrackAll(windowId) {
  if (windowId) {
    const window = trackedWindows.get(windowId);
    if (window) {
      for (const tab of window.tabs.values()) {
        trackedTabs.delete(tab.id);
        if (tab.$TSTUniqueId)
          trackedTabsByUniqueId.delete(tab.$TSTUniqueId.id)
      }
      window.tabs.clear();
      window.tabs = undefined;
      window.order = undefined;
      trackedWindows.delete(windowId);
      activeTabForWindow.delete(windowId);
      highlightedTabsForWindow.delete(windowId);
    }
  }
  else {
    trackedWindows.clear();
    trackedTabs.clear();
    trackedTabsByUniqueId.clear();
  }
}

function isTracked(apiTabId) {
  return trackedTabs.has(apiTabId);
}

// queryings

const MATCHING_ATTRIBUTES = `
active
attention
audible
autoDiscardable
cookieStoreId
discarded
favIconUrl
hidden
highlighted
id
incognito
index
isArticle
isInReaderMode
pinned
sessionId
status
successorId
title
url
`.trim().split(/\s+/);

export function queryAll(conditions) {
  fixupQuery(conditions);
  if (conditions.windowId || conditions.ordered) {
    let tabs = [];
    for (const window of trackedWindows.values()) {
      if (conditions.windowId && !matched(window.id, conditions.windowId))
        continue;
      const tabsIterator = !conditions.ordered ? window.tabs.values() :
        conditions.last ? window.getReversedOrderedTabs(conditions.fromId) :
          window.getOrderedTabs(conditions.fromId);
      tabs = tabs.concat(extractMatchedTabs(tabsIterator, conditions));
    }
    return tabs;
  }
  else {
    return extractMatchedTabs(trackedTabs.values(), conditions);
  }
}

function extractMatchedTabs(tabs, conditions) {
  const matchedTabs = [];
  TAB_MACHING:
  for (const tab of tabs) {
    for (const attribute of MATCHING_ATTRIBUTES) {
      if (attribute in conditions &&
          !matched(tab[attribute], conditions[attribute]))
        continue TAB_MACHING;
      if (`!${attribute}` in conditions &&
          matched(tab[attribute], conditions[`!${attribute}`]))
        continue TAB_MACHING;
    }
    if ('states' in conditions && tab.$TSTStates) {
      for (let i = 0, maxi = conditions.states.length; i < maxi; i += 2) {
        const state   = conditions.states[i];
        const pattern = conditions.states[i+1];
        if (!matched(tab.$TSTStates[state], pattern))
          continue TAB_MACHING;
      }
    }
    if ('attributes' in conditions && tab.$TSTAttributes) {
      for (let i = 0, maxi = conditions.attributes.length; i < maxi; i += 2) {
        const attribute = conditions.attributes[i];
        const pattern   = conditions.attributes[i+1];
        if (!matched(tab.$TSTAttributes[attribute], pattern))
          continue TAB_MACHING;
      }
    }

    if (conditions.living &&
        !ensureLivingTab(tab))
      continue TAB_MACHING;
    if (conditions.normal &&
        (tab.hidden ||
         tab.pinned))
      continue TAB_MACHING;
    if (conditions.visible &&
        (tab.$TSTStates[Constants.kTAB_STATE_COLLAPSED] ||
         tab.hidden))
      continue TAB_MACHING;
    if (conditions.controllable &&
        tab.hidden)
      continue TAB_MACHING;

    const extracted = conditions.element ? tab.$TSTElement : tab;
    if (extracted) {
      matchedTabs.push(extracted);
      if (conditions.first || conditions.last)
        break TAB_MACHING;
    }
  }
  return matchedTabs;
}

function matched(value, pattern) {
  if (pattern instanceof RegExp &&
      !pattern.test(String(value)))
    return false;
  if (pattern instanceof Set &&
      !pattern.has(value))
    return false;
  if (Array.isArray(pattern) &&
      !pattern.includes(value))
    return false;
  if (typeof pattern == 'function' &&
      !pattern(value))
    return false;
  if (typeof pattern == 'boolean' &&
      !!value !== pattern)
    return false;
  if (typeof pattern == 'string' &&
      String(value || '') != pattern)
    return false;
  if (typeof pattern == 'number' &&
      value != pattern)
    return false;
  return true;
}

export function query(conditions) {
  fixupQuery(conditions);
  if (conditions.last)
    conditions.ordered = true;
  else
    conditions.first = true;
  let tabs = [];
  if (conditions.windowId || conditions.ordered) {
    for (const window of trackedWindows.values()) {
      if (conditions.windowId && !matched(window.id, conditions.windowId))
        continue;
      const tabsIterator = !conditions.ordered ? window.tabs.values() :
        conditions.last ? window.getReversedOrderedTabs(conditions.fromId) :
          window.getOrderedTabs(conditions.fromId);
      tabs = tabs.concat(extractMatchedTabs(tabsIterator, conditions));
      if (tabs.length > 0)
        break;
    }
  }
  else {
    tabs = extractMatchedTabs(trackedTabs.values(), conditions);
  }
  return tabs.length > 0 ? tabs[0] : null ;
}

function fixupQuery(conditions) {
  if (conditions.fromId)
    conditions.ordered = true;
  if ((conditions.normal ||
       conditions.visible ||
       conditions.controllable ||
       conditions.pinned) &&
       !('living' in conditions))
    conditions.living = true;
}


//===================================================================
// Tab Related Utilities
//===================================================================

export function setWindow(targetWindow) {
  return mTargetWindow = targetWindow;
}

export function getWindow() {
  return mTargetWindow;
}

export function sort(tabs) {
  return tabs.sort(documentPositionComparator);
}

function documentPositionComparator(a, b) {
  if (a === b || !a || !b)
    return 0;

  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING)
    return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING)
    return 1;

  return 0;
}

export function sanitize(apiTab) {
  apiTab = Object.assign({}, apiTab);
  delete apiTab.$TSTElement;
  delete apiTab.$TSTUniqueId;
  delete apiTab.$TSTStates;
  delete apiTab.$TSTAttributes;
  return apiTab;
}


//===================================================================
// Operate Tab ID
//===================================================================

export function makeTabId(apiTab) {
  return `tab-${apiTab.windowId}-${apiTab.id}`;
}

export async function requestUniqueId(tabOrId, options = {}) {
  let tabId = tabOrId;
  let tab   = null;
  if (typeof tabOrId == 'number') {
    tab = getTabById(tabOrId);
  }
  else {
    tabId = tabOrId.apiTab.id;
    tab   = tabOrId;
  }

  if (options.inRemote) {
    return await browser.runtime.sendMessage({
      type:     Constants.kCOMMAND_REQUEST_UNIQUE_ID,
      id:       tabId,
      forceNew: !!options.forceNew
    });
  }

  let originalId    = null;
  let originalTabId = null;
  let duplicated    = false;
  if (!options.forceNew) {
    let oldId = await browser.sessions.getTabValue(tabId, Constants.kPERSISTENT_ID);
    if (oldId && !oldId.tabId) // ignore broken information!
      oldId = null;

    if (oldId) {
      // If the tab detected from stored tabId is different, it is duplicated tab.
      try {
        const tabWithOldId = getTabById(oldId.tabId);
        if (!tabWithOldId)
          throw new Error(`Invalid tab ID: ${oldId.tabId}`);
        originalId = tabWithOldId.getAttribute(Constants.kPERSISTENT_ID) /* (await tabWithOldId.uniqueId).id // don't try to wait this, because it sometime causes deadlock */;
        duplicated = tab && tabWithOldId != tab && originalId == oldId.id;
        if (duplicated)
          originalTabId = oldId.tabId;
        else
          throw new Error(`Invalid tab ID: ${oldId.tabId}`);
      }
      catch(e) {
        ApiTabs.handleMissingTabError(e);
        // It fails if the tab doesn't exist.
        // There is no live tab for the tabId, thus
        // this seems to be a tab restored from session.
        // We need to update the related tab id.
        await browser.sessions.setTabValue(tabId, Constants.kPERSISTENT_ID, {
          id:    oldId.id,
          tabId: tabId
        });
        return {
          id:            oldId.id,
          originalId:    null,
          originalTabId: oldId.tabId,
          restored:      true
        };
      }
    }
  }

  const adjective   = Constants.kID_ADJECTIVES[Math.floor(Math.random() * Constants.kID_ADJECTIVES.length)];
  const noun        = Constants.kID_NOUNS[Math.floor(Math.random() * Constants.kID_NOUNS.length)];
  const randomValue = Math.floor(Math.random() * 1000);
  const id          = `tab-${adjective}-${noun}-${Date.now()}-${randomValue}`;
  // tabId is for detecttion of duplicated tabs
  await browser.sessions.setTabValue(tabId, Constants.kPERSISTENT_ID, { id, tabId });
  return { id, originalId, originalTabId, duplicated };
}

export function updateUniqueId(tab) {
  tab.uniqueId = requestUniqueId(tab, {
    inRemote: !!mTargetWindow
  }).then(uniqueId => {
    if (uniqueId && ensureLivingTab(tab)) // possibly removed from document while waiting
      setAttribute(tab, Constants.kPERSISTENT_ID, uniqueId.id);
    return uniqueId || {};
  }).catch(error => {
    console.log(`FATAL ERROR: Failed to get unique id for a tab ${tab.apiTab.id}: `, String(error), error.stack);
    return {};
  });
  return tab.uniqueId;
}

export async function getUniqueIds(apiTabs) {
  const uniqueIds = await Promise.all(apiTabs.map(apiTab => browser.sessions.getTabValue(apiTab.id, Constants.kPERSISTENT_ID)));
  return uniqueIds.map(id => id && id.id || '?');
}


//===================================================================
// Event Handling
//===================================================================

export const onBuilt            = new EventListenerManager();
export const onGroupTabDetected = new EventListenerManager();
export const onLabelUpdated     = new EventListenerManager();
export const onFaviconUpdated   = new EventListenerManager();
export const onStateChanged     = new EventListenerManager();
export const onPinned           = new EventListenerManager();
export const onUnpinned         = new EventListenerManager();
export const onHidden           = new EventListenerManager();
export const onShown            = new EventListenerManager();
export const onParentTabUpdated = new EventListenerManager();
export const onTabElementMoved  = new EventListenerManager();
export const onCollapsedStateChanging = new EventListenerManager();
export const onCollapsedStateChanged  = new EventListenerManager();

export const onBeforeCreate     = new EventListenerManager();
export const onCreating         = new EventListenerManager();
export const onCreated          = new EventListenerManager();
export const onRemoving         = new EventListenerManager();
export const onRemoved          = new EventListenerManager();
export const onMoving           = new EventListenerManager();
export const onMoved            = new EventListenerManager();
export const onActivating       = new EventListenerManager();
export const onActivated        = new EventListenerManager();
export const onUpdated          = new EventListenerManager();
export const onRestoring        = new EventListenerManager();
export const onRestored         = new EventListenerManager();
export const onWindowRestoring  = new EventListenerManager();
export const onAttached         = new EventListenerManager();
export const onDetached         = new EventListenerManager();

function normalizeOperatingTabIds(idOrIds) {
  if (!Array.isArray(idOrIds))
    idOrIds = [idOrIds];
  return idOrIds
    .map(id => parseInt(id))
    .filter(id => !!id)
    .map(id => typeof id == 'string' ? parseInt(id.match(/^tab-\d+-(\d+)$/)[1]) : id);
}

async function waitUntilTabsAreOperated(params = {}) {
  const ids = params.ids && normalizeOperatingTabIds(params.ids);
  let promises = [];
  if (params.operatingTabsInWindow) {
    if (ids) {
      for (const id of ids) {
        if (params.operatingTabsInWindow.has(id))
          promises.push(params.operatingTabsInWindow.get(id));
      }
    }
    else {
      promises.splice(0, 0, ...params.operatingTabsInWindow.values());
    }
  }
  else if (params.operatingTabs) {
    for (const operatingTabsInWindow of params.operatingTabs.values()) {
      if (ids) {
        for (let i = ids.length - 1; i > -1; i--) {
          const id = ids[i];
          if (operatingTabsInWindow.has(id)) {
            promises.push(operatingTabsInWindow.get(id));
            ids.splice(i, 1);
          }
        }
        if (ids.length == 0)
          break;
      }
      else {
        promises.splice(0, 0, ...operatingTabsInWindow.values());
      }
    }
  }
  else {
    throw new Error('missing required parameter: operatingTabs or operatingTabsInWindow');
  }
  promises = promises.filter(operating => !!operating);
  if (promises.length > 0)
    return Promise.all(promises);
  return [];
}

export function hasOperatingTab(params = {}) {
  if (!params.operatingTabs) {
    throw new Error('missing required parameter: operatingTabs');
  }
  if (params.windowId) {
    const operatingTabsInWindow = params.operatingTabs.get(params.windowId);
    return operatingTabsInWindow ? operatingTabsInWindow.size > 0 : false;
  }
  for (const operatingTabsInWindow of params.operatingTabs.values()) {
    if (operatingTabsInWindow.size > 0)
      return true;
  }
  return false;
}

const mCreatingTabs = new Map();

export function addCreatingTab(tab) {
  let onTabCreated;
  const creatingTabs = mCreatingTabs.get(tab.apiTab.windowId) || new Map();
  if (configs.acceleratedTabCreation) {
    creatingTabs.set(tab.apiTab.id, tab.uniqueId);
    onTabCreated = () => {};
  }
  else {
    creatingTabs.set(tab.apiTab.id, new Promise((resolve, _aReject) => {
      onTabCreated = (uniqueId) => { resolve(uniqueId); };
    }));
  }
  mCreatingTabs.set(tab.apiTab.windowId, creatingTabs);
  tab.uniqueId.then(_aUniqueId => {
    creatingTabs.delete(tab.apiTab.id);
  });
  return onTabCreated;
}

export function hasCreatingTab(windowId = null) {
  return hasOperatingTab({ operatingTabs: mCreatingTabs, windowId });
}

export async function waitUntilAllTabsAreCreated(windowId = null) {
  const params = {};
  if (windowId) {
    params.operatingTabsInWindow = mCreatingTabs.get(windowId);
    if (!params.operatingTabsInWindow)
      return;
  }
  else {
    params.operatingTabs = mCreatingTabs;
  }
  return waitUntilTabsAreOperated(params)
    .then(aUniqueIds => aUniqueIds.map(uniqueId => getTabByUniqueId(uniqueId.id)));
}

export async function waitUntilTabsAreCreated(idOrIds) {
  return waitUntilTabsAreOperated({ ids: idOrIds, operatingTabs: mCreatingTabs })
    .then(aUniqueIds => aUniqueIds.map(uniqueId => getTabByUniqueId(uniqueId.id)));
}

const mMovingTabs = new Map();

export function hasMovingTab(windowId = null) {
  return hasOperatingTab({ operatingTabs: mMovingTabs, windowId });
}

export function addMovingTabId(tabId, windowId) {
  let onTabMoved;
  const promisedMoved = new Promise((resolve, _aReject) => {
    onTabMoved = resolve;
  });
  const movingTabs = mMovingTabs.get(windowId) || new Map();
  movingTabs.set(tabId, promisedMoved);
  mMovingTabs.set(windowId, movingTabs);
  promisedMoved.then(() => {
    movingTabs.delete(tabId);
  });
  return onTabMoved;
}

export async function waitUntilAllTabsAreMoved(windowId = null) {
  const params = {};
  if (windowId) {
    params.operatingTabsInWindow = mMovingTabs.get(windowId);
    if (!params.operatingTabsInWindow)
      return;
  }
  else {
    params.operatingTabs = mMovingTabs;
  }
  return waitUntilTabsAreOperated(params)
}

browser.windows.onRemoved.addListener(windowId => {
  mCreatingTabs.delete(windowId);
  mMovingTabs.delete(windowId);
});


//===================================================================
// Create Tabs
//===================================================================

export function buildTab(apiTab, options = {}) {
  log('build tab for ', apiTab);
  apiTab.$TSTStates = apiTab.$TSTStates || {};
  apiTab.$TSTAttributes = apiTab.$TSTAttributes || {};
  const tab = document.createElement('li');
  apiTab.$TSTElement = tab;
  tab.apiTab = apiTab;
  setAttribute(tab, 'id', makeTabId(apiTab));
  setAttribute(tab, Constants.kAPI_TAB_ID, apiTab.id || -1);
  setAttribute(tab, Constants.kAPI_WINDOW_ID, apiTab.windowId || -1);
  //setAttribute(tab, Constants.kCHILDREN, '');
  tab.classList.add('tab');
  if (apiTab.active)
    addState(tab, Constants.kTAB_STATE_ACTIVE);
  addState(tab, Constants.kTAB_STATE_SUBTREE_COLLAPSED);

  const labelContainer = document.createElement('span');
  labelContainer.classList.add(Constants.kLABEL);
  const label = labelContainer.appendChild(document.createElement('span'));
  label.classList.add(`${Constants.kLABEL}-content`);
  tab.appendChild(labelContainer);

  onBuilt.dispatch(tab, options);

  if (options.existing)
    addState(tab, Constants.kTAB_STATE_ANIMATION_READY);

  if (apiTab.id)
    updateUniqueId(tab);
  else
    tab.uniqueId = Promise.resolve({
      id:            null,
      originalId:    null,
      originalTabId: null
    });

  tab.uniqueId.then(uniqueId => {
    if (isTracked(apiTab.id))
      apiTab.$TSTUniqueId = uniqueId;
  });

  tab.childTabs = [];
  tab.parentTab = null;
  tab.ancestorTabs = [];

  initPromisedStatus(tab);

  return tab;
}


//===================================================================
// Get Tabs
//===================================================================

// basics
function assertValidHint(hint) {
  if (!hint)
    return;
  if (/string|number/.test(typeof hint))
    return;
  if (hint.parentNode)
    return;
  const error = new Error('FATAL ERROR: invalid hint is given');
  log(error.message, error.stack);
  throw error;
}

export function getTabsContainer(hint) {
  assertValidHint(hint);

  if (!hint)
    hint = mTargetWindow || allTabsContainer.firstChild;

  if (typeof hint == 'number')
    return document.querySelector(`#window-${hint}`);

  const tab = getTabFromChild(hint);
  if (tab)
    return tab.parentNode;

  if (hint &&
      hint.dataset &&
      hint.dataset.windowId)
    return document.querySelector(`#window-${hint.dataset.windowId}`);

  return null;
}

export function getTabFromChild(node, options = {}) {
  if (!node)
    return null;
  if (node.nodeType != Node.ELEMENT_NODE)
    node = node.parentNode;
  const tab = node.closest('.tab');
  if (options.force)
    return tab;
  return ensureLivingTab(tab);
}

export function getTabById(idOrInfo) {
  if (!idOrInfo)
    return null;

  if (idOrInfo instanceof Element)
    return idOrInfo;

  if (typeof idOrInfo == 'string') { // tab-x-x
    const matched = idOrInfo.match(/^tab-(\d+)-(\d+)$/);
    if (matched) {
      const tab = trackedTabs.get(parseInt(matched[2]));
      return ensureLivingTab(tab) && tab.windowId == matched[1] && tab.$TSTElement;
    }
    // possible unique id
    return getTabByUniqueId(idOrInfo);
  }

  if (typeof idOrInfo == 'number') { // tabs.Tab.id
    const tab = trackedTabs.get(idOrInfo);
    return ensureLivingTab(tab) && tab.$TSTElement;
  }

  if (idOrInfo.id && idOrInfo.windowId) { // tabs.Tab
    const tab = trackedTabs.get(idOrInfo.id);
    return ensureLivingTab(tab) && tab.windowId == idOrInfo.windowId && tab.$TSTElement;
  }
  else if (!idOrInfo.window) { // { tab: tabs.Tab.id }
    const tab = trackedTabs.get(idOrInfo.tab);
    return ensureLivingTab(tab) && tab.$TSTElement;
  }
  else { // { tab: tabs.Tab.id, window: windows.Window.id }
    const tab = trackedTabs.get(idOrInfo.tab);
    return ensureLivingTab(tab) && tab.windowId == idOrInfo.window && tab.$TSTElement;
  }

  return null;
}

export function getTabByUniqueId(id) {
  if (!id)
    return null;
  return ensureLivingTab(trackedTabsByUniqueId.get(id));
}

export function getTabLabel(tab) {
  return tab && tab.querySelector(`.${Constants.kLABEL}`);
}

export function getTabLabelContent(tab) {
  return tab && tab.querySelector(`.${Constants.kLABEL}-content`);
}

// Note that this function can return null if it is the first tab of
// a new window opened by the "move tab to new window" command.
export function getActiveTab(hint) {
  const container = getTabsContainer(hint);
  const tab = container && ensureLivingTab(activeTabForWindow.get(container.windowId));
  return tab && tab.$TSTElement;
}
export function getActiveTabs() {
  return Array.from(activeTabForWindow.values(), tab => ensureLivingTab(tab) && tab.$TSTElement);
}

export function getNextTab(tab) {
  if (!tab || !tab.id)
    return null;
  assertValidHint(tab);
  return query({
    windowId: tab.apiTab.windowId,
    fromId:   tab.apiTab.id,
    living:   true,
    index:    (index => index > tab.apiTab.index),
    element:  true
  });
}

export function getPreviousTab(tab) {
  if (!tab || !tab.id)
    return null;
  assertValidHint(tab);
  return query({
    windowId: tab.apiTab.windowId,
    fromId:   tab.apiTab.id,
    living:   true,
    index:    (index => index < tab.apiTab.index),
    last:     true,
    element:  true
  });
}

export function getFirstTab(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return null;
  return query({
    windowId: container.windowId,
    living:   true,
    ordered:  true,
    element:  true
  });
}

export function getLastTab(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return null;
  return query({
    windowId: container.windowId,
    living:   true,
    last:     true,
    element:  true
  });
}

export function getLastVisibleTab(hint) { // visible, not-collapsed, not-hidden
  const container = getTabsContainer(hint);
  if (!container)
    return null;
  return query({
    windowId: container.windowId,
    visible:  true,
    last:     true,
    element:  true
  });
}

export function getLastOpenedTab(hint) {
  const tabs = getTabs(hint);
  return tabs.length > 0 ?
    tabs.sort((a, b) => b.apiTab.id - a.apiTab.id)[0] :
    null ;
}

function getTabIndex(tab, options = {}) {
  if (!ensureLivingTab(tab))
    return -1;
  assertValidHint(tab);

  let tabs = getAllTabs(tab);
  if (Array.isArray(options.ignoreTabs) &&
      options.ignoreTabs.length > 0)
    tabs = tabs.filter(tab => !options.ignoreTabs.includes(tab));

  return tabs.indexOf(tab);
}

export function calculateNewTabIndex(params) {
  if (params.insertBefore)
    return getTabIndex(params.insertBefore, params);
  if (params.insertAfter)
    return getTabIndex(params.insertAfter, params) + 1;
  return -1;
}


export function getNextNormalTab(tab) {
  if (!ensureLivingTab(tab))
    return null;
  assertValidHint(tab);
  return query({
    windowId: tab.apiTab.windowId,
    fromId:   tab.apiTab.id,
    normal:   true,
    index:    (index => index > tab.apiTab.index),
    element:  true
  });
}

export function getPreviousNormalTab(tab) {
  if (!ensureLivingTab(tab))
    return null;
  assertValidHint(tab);
  return query({
    windowId: tab.apiTab.windowId,
    fromId:   tab.apiTab.id,
    normal:   true,
    index:    (index => index < tab.apiTab.index),
    last:     true,
    element:  true
  });
}


// tree basics

export function ensureLivingTab(tab) {
  if (!tab ||
      !tab.id)
    return null;
  if (tab instanceof Element) {
    if (!tab.parentNode ||
        !isTracked(tab.apiTab.id) ||
        hasState(tab, Constants.kTAB_STATE_REMOVING))
      return null;
  }
  else {
    if (!tab.$TSTElement ||
        !tab.$TSTElement.parentNode ||
        !isTracked(tab.id) ||
        tab.$TSTStates[Constants.kTAB_STATE_REMOVING])
      return null;
  }
  return tab;
}

function assertInitializedTab(tab) {
  if (!tab.apiTab)
    throw new Error(`FATAL ERROR: the tab ${tab.id} is not initialized yet correctly! (no API tab information)\n${new Error().stack}`);
  if (!tab.childTabs)
    throw new Error(`FATAL ERROR: the tab ${tab.id} is not initialized yet correctly! (missing priperty "childTabs")\n${new Error().stack}`);
  return true;
}

export function getOpenerTab(tab) {
  if (!ensureLivingTab(tab) ||
      !tab.apiTab ||
      !tab.apiTab.openerTabId ||
      tab.apiTab.openerTabId == tab.apiTab.id)
    return null;
  return getTabById({ id: tab.apiTab.openerTabId, windowId: tab.apiTab.windowId });
}

export function getParentTab(child) {
  if (!ensureLivingTab(child))
    return null;
  assertValidHint(child);
  return ensureLivingTab(child.parentTab);
}

export function getAncestorTabs(descendant, options = {}) {
  if (!descendant)
    return [];
  if (!options.force)
    return (
      // slice(0) is required to guard the cached array from destructive methods liek sort()!
      descendant.ancestorTabs && descendant.ancestorTabs.slice(0) ||
      []
    );
  const ancestors = [];
  while (true) {
    const parent = getParentTab(descendant);
    if (!parent)
      break;
    ancestors.push(parent);
    descendant = parent;
  }
  return ancestors;
}

export function getVisibleAncestorOrSelf(descendant) {
  for (const ancestor of getAncestorTabs(descendant)) {
    if (!isCollapsed(ancestor))
      return ancestor;
  }
  if (!isCollapsed(descendant))
    return descendant;
  return null;
}

export function getRootTab(descendant) {
  const ancestors = getAncestorTabs(descendant);
  return ancestors.length > 0 ? ancestors[ancestors.length-1] : descendant ;
}

function getSiblingTabs(tab) {
  if (!ensureLivingTab(tab))
    return [];
  assertValidHint(tab);
  if (!ensureLivingTab(tab.parentTab))
    return getRootTabs(tab);
  assertInitializedTab(tab);
  assertInitializedTab(tab.parentTab);
  return tab.parentTab.childTabs.filter(ensureLivingTab);
}

export function getNextSiblingTab(tab) {
  if (!ensureLivingTab(tab))
    return null;
  assertValidHint(tab);
  const siblings = getSiblingTabs(tab);
  const index = siblings.indexOf(tab);
  return index < siblings.length - 1 ? siblings[index + 1] : null ;
}

export function getPreviousSiblingTab(tab) {
  if (!ensureLivingTab(tab))
    return null;
  assertValidHint(tab);
  const siblings = getSiblingTabs(tab);
  const index = siblings.indexOf(tab);
  return index > 0 ? siblings[index - 1] : null ;
}

export function getChildTabs(parent) {
  if (!ensureLivingTab(parent))
    return [];
  assertValidHint(parent);
  assertInitializedTab(parent);
  return parent.childTabs.filter(ensureLivingTab);
}

export function getFirstChildTab(parent) {
  if (!ensureLivingTab(parent))
    return null;
  assertValidHint(parent);
  assertInitializedTab(parent);
  const tabs = parent.childTabs.filter(ensureLivingTab);
  return tabs.length > 0 ? tabs[0] : null ;
}

export function getLastChildTab(parent) {
  if (!ensureLivingTab(parent))
    return null;
  assertValidHint(parent);
  assertInitializedTab(parent);
  const tabs = parent.childTabs.filter(ensureLivingTab);
  return tabs.length > 0 ? tabs[tabs.length - 1] : null ;
}

/*
function getChildTabIndex(child, parent) {
  if (!ensureLivingTab(child) ||
      !ensureLivingTab(parent))
    return -1;
  assertValidHint(child);
  assertValidHint(parent);
  assertInitializedTab(parent);
  const tabs = parent.childTabs.filter(ensureLivingTab);
  return tabs.indexOf(child);
}
*/

export function getDescendantTabs(root) {
  if (!ensureLivingTab(root))
    return [];
  assertValidHint(root);
  assertInitializedTab(root);

  let descendants = [];
  const children = root.childTabs.filter(ensureLivingTab);
  for (const child of children) {
    descendants.push(child);
    descendants = descendants.concat(getDescendantTabs(child));
  }
  return descendants;
}

export function getLastDescendantTab(root) {
  const descendants = getDescendantTabs(root);
  return descendants.length ? descendants[descendants.length-1] : null ;
}


// grab tabs

export function getAllTabs(hint, options = {}) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll(Object.assign({}, {
    windowId: container.windowId,
    living:   true,
    ordered:  true,
    element:  true
  }, options));
}

export function getTabs(hint, options = {}) { // only visible, including collapsed and pinned
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll(Object.assign({}, {
    windowId:     container.windowId,
    controllable: true,
    ordered:      true,
    element:      true
  }, options));
}

export function getNormalTabs(hint, options = {}) { // only visible, including collapsed, not pinned
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll(Object.assign({}, {
    windowId: container.windowId,
    normal:   true,
    ordered:  true,
    element:  true
  }, options));
}

export function getVisibleTabs(hint, options = {}) { // visible, not-collapsed, not-hidden
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll(Object.assign({}, {
    windowId: container.windowId,
    visible:  true,
    ordered:  true,
    element:  true
  }, options));
}

export function getPinnedTabs(hint, options = {}) { // visible, pinned
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll(Object.assign({}, {
    windowId: container.windowId,
    pinned:   true,
    ordered:  true,
    element:  true
  }, options));
}


export function getUnpinnedTabs(hint) { // visible, not pinned
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId: container.windowId,
    living:   true,
    pinned:   false,
    ordered:  true,
    element:  true
  });
}

/*
function getAllRootTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId:   container.windowId,
    living:     true,
    ordered:    true,
    attributes: [Constants.kPARENT, '']
    element:    true
  });
}
*/

export function getRootTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId:     container.windowId,
    controllable: true,
    ordered:      true,
    attributes:   [Constants.kPARENT, ''],
    element:      true
  });
}

/*
function getVisibleRootTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId:   container.windowId,
    visible:    true,
    ordered:    true,
    attributes: [Constants.kPARENT, '']
    element:    true
  });
}

function getVisibleLoadingTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId: container.windowId,
    visible:  true,
    status:   'loading',
    ordered:  true,
    element:  true
  });
}
*/

export function collectRootTabs(tabs) {
  return tabs.filter(tab => {
    if (!ensureLivingTab(tab))
      return false;
    const parent = getParentTab(tab);
    return !parent || !tabs.includes(parent);
  });
}

/*
function getIndentedTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId:     container.windowId,
    controllable: true,
    attributes:   [Constants.kPARENT, /./],
    ordered:      true,
    element:      true
  });
}

function getVisibleIndentedTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId:   container.windowId,
    visible:    true,
    attributes: [Constants.kPARENT, /./],
    ordered:    true,
    element:    true
  });
}
*/

export function getDraggingTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId: container.windowId,
    living:   true,
    states:   [Constants.kTAB_STATE_DRAGGING, true],
    ordered:  true,
    element:  true
  });
}

export function getDuplicatingTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId: container.windowId,
    living:   true,
    states:   [Constants.kTAB_STATE_DUPLICATING, true],
    ordered:  true,
    element:  true
  });
}

export function getHighlightedTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];
  return queryAll({
    windowId:    container.windowId,
    living:      true,
    highlighted: true,
    ordered:     true,
    element:     true
  });
}

export function getSelectedTabs(hint) {
  const container = getTabsContainer(hint);
  if (!container)
    return [];

  const selectedTabs = queryAll({
    windowId: container.windowId,
    living:   true,
    states:   [Constants.kTAB_STATE_SELECTED, true],
    ordered:  true,
    element:  true
  });
  if (!container.classList.contains(Constants.kTABBAR_STATE_MULTIPLE_HIGHLIGHTED))
    return selectedTabs;

  const highlightedTabs = queryAll({
    windowId:    container.windowId,
    living:      true,
    highlighted: true,
    ordered:     true,
    element:     true
  });
  return Array.from(new Set(selectedTabs.concat(highlightedTabs)))
    .sort((a, b) => a.index - b.index);
}



// misc.

export function getFirstNormalTab(hint) { // visible, not-collapsed, not-pinned
  const container = getTabsContainer(hint);
  return container && query({
    windowId: container.windowId,
    normal:   true,
    ordered:  true,
    element:  true
  });
}

export function getFirstVisibleTab(hint) { // visible, not-collapsed, not-hidden
  const container = getTabsContainer(hint);
  return container && query({
    windowId: container.windowId,
    visible:  true,
    ordered:  true,
    element:  true
  });
}

/*
function getLastVisibleTab(hint) { // visible, not-collapsed, not-hidden
  const container = getTabsContainer(hint);
  if (!container)
    return null;
  return container && query({
    windowId: container.windowId,
    visible:  true,
    last:     true,
    element:  true
  });
}
*/

export function getNextVisibleTab(tab) { // visible, not-collapsed
  if (!ensureLivingTab(tab))
    return null;
  assertValidHint(tab);
  return query({
    windowId: tab.apiTab.windowId,
    fromId:   tab.apiTab.id,
    visible:  true,
    index:    (index => index > tab.apiTab.index),
    element:  true
  });
}

export function getPreviousVisibleTab(tab) { // visible, not-collapsed
  if (!ensureLivingTab(tab))
    return null;
  assertValidHint(tab);
  return query({
    windowId: tab.apiTab.windowId,
    fromId:   tab.apiTab.id,
    visible:  true,
    index:    (index => index < tab.apiTab.index),
    last:     true,
    element:  true
  });
}

/*
function getVisibleIndex(tab) {
  if (!ensureLivingTab(tab))
    return -1;
  assertValidHint(tab);
  const container = getTabsContainer(hint);
  return Tabs.queryAll({
    windowId: container.windowId,
    visible:  true,
    index:    (index => index > tab.apiTab.index),
    ordered:  true
  ]).length;
}
*/

export async function doAndGetNewTabs(asyncTask, hint) {
  const tabsQueryOptions = {
    windowType: 'normal'
  };
  if (hint) {
    const container = getTabsContainer(hint);
    if (container)
      tabsQueryOptions.windowId = parseInt(container.dataset.windowId);
  }
  const beforeApiTabs = await browser.tabs.query(tabsQueryOptions);
  const beforeApiIds  = beforeApiTabs.map(apiTab => apiTab.id);
  await asyncTask();
  const afterApiTabs = await browser.tabs.query(tabsQueryOptions);
  const addedApiTabs = afterApiTabs.filter(afterApiTab => !beforeApiIds.includes(afterApiTab.id));
  const addedTabs    = addedApiTabs.map(getTabById);
  return addedTabs;
}

export function getNextActiveTab(tab, options = {}) { // if the current tab is closed...
  const ignoredTabs = (options.ignoredTabs || []).slice(0);
  let foundTab = tab;
  do {
    ignoredTabs.push(foundTab);
    foundTab = getNextSiblingTab(foundTab);
  } while (foundTab && ignoredTabs.includes(foundTab));
  if (!foundTab) {
    foundTab = tab;
    do {
      ignoredTabs.push(foundTab);
      foundTab = getPreviousVisibleTab(foundTab);
    } while (foundTab && ignoredTabs.includes(foundTab));
  }
  return foundTab;
}


export function getGroupTabForOpener(opener) {
  const tab = (opener instanceof Element) ? opener : (getTabById(opener) || getTabByUniqueId(opener));
  if (!tab)
    return null;
  return query({
    windowId:   tab.parentNode.windowId,
    living:     true,
    attributes: [
      Constants.kCURRENT_URI,
      new RegExp(`openerTabId=${tab.getAttribute(Constants.kPERSISTENT_ID)}($|[#&])`)
    ],
    element:    true
  });
}

export function getOpenerFromGroupTab(groupTab) {
  if (!isGroupTab(groupTab))
    return null;
  const matchedOpenerTabId = groupTab.apiTab.url.match(/openerTabId=([^&;]+)/);
  return matchedOpenerTabId && getTabById(matchedOpenerTabId[1]);
}




//===================================================================
// Tab Information
//===================================================================

export function isActive(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.active);
}

export function isPinned(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.pinned);
}

export function isAudible(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.audible);
}

export function isSoundPlaying(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.audible && !tab.apiTab.mutedInfo.muted);
}

export function maybeSoundPlaying(tab) {
  return ensureLivingTab(tab) &&
         (isSoundPlaying(tab) ||
          (hasState(tab, Constants.kTAB_STATE_HAS_SOUND_PLAYING_MEMBER) &&
           hasChildTabs(tab)));
}

export function isMuted(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.mutedInfo && tab.apiTab.mutedInfo.muted);
}

export function maybeMuted(tab) {
  return ensureLivingTab(tab) &&
         (isMuted(tab) ||
          (hasState(tab, Constants.kTAB_STATE_HAS_MUTED_MEMBER) &&
           hasChildTabs(tab)));
}

export function isHidden(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.hidden);
}

export function isCollapsed(tab) {
  return ensureLivingTab(tab) &&
           hasState(tab, Constants.kTAB_STATE_COLLAPSED);
}

export function isDiscarded(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.discarded);
}

export function isPrivateBrowsing(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.incognito);
}

export function isOpening(tab) {
  return ensureLivingTab(tab) &&
           hasState(tab, Constants.kTAB_STATE_OPENING);
}

export function isDuplicating(tab) {
  return ensureLivingTab(tab) &&
           hasState(tab, Constants.kTAB_STATE_DUPLICATING);
}

export function isNewTabCommandTab(tab) {
  return ensureLivingTab(tab) &&
           configs.guessNewOrphanTabAsOpenedByNewTabCommand &&
           assertInitializedTab(tab) &&
           tab.apiTab.url == configs.guessNewOrphanTabAsOpenedByNewTabCommandUrl;
}

export function isSubtreeCollapsed(tab) {
  return ensureLivingTab(tab) &&
         hasState(tab, Constants.kTAB_STATE_SUBTREE_COLLAPSED);
}

/*
function shouldCloseTabSubtreeOf(tab) {
  return (hasChildTabs(tab) &&
          (configs.closeParentBehavior == Constants.kCLOSE_PARENT_BEHAVIOR_CLOSE_ALL_CHILDREN ||
           isSubtreeCollapsed(tab)));
}
*/

/*
function shouldCloseLastTabSubtreeOf(tab) {
  return (ensureLivingTab(tab) &&
          shouldCloseTabSubtreeOf(tab) &&
          getDescendantTabs(tab).length + 1 == getAllTabs(tab).length);
}
*/

export function isGroupTab(tab) {
  if (!tab)
    return false;
  assertInitializedTab(tab);
  return hasState(tab, Constants.kTAB_STATE_GROUP_TAB) ||
         tab.apiTab.url.indexOf(Constants.kGROUP_TAB_URI) == 0;
}

export function isTemporaryGroupTab(tab) {
  if (!isGroupTab(tab))
    return false;
  return /[&?]temporary=true/.test(tab.apiTab.url);
}

export function isSelected(tab) {
  return ensureLivingTab(tab) &&
           (hasState(tab, Constants.kTAB_STATE_SELECTED) ||
            (isMultihighlighted(tab) && !!(tab.apiTab && tab.apiTab.highlighted)));
}

export function isHighlighted(tab) {
  return ensureLivingTab(tab) &&
           !!(tab.apiTab && tab.apiTab.highlighted);
}

export function isMultiselected(tab) {
  return isSelected(tab) &&
           (isMultihighlighted(tab) ||
            queryAll({
              windowId: tab.apiTab.windowId,
              living:   true,
              states:   [Constants.kTAB_STATE_SELECTED, true]
            }).length > 1);
}

export function isMultihighlighted(tab) {
  return tab.parentNode.classList.contains(Constants.kTABBAR_STATE_MULTIPLE_HIGHLIGHTED);
}

export function isLocked(_aTab) {
  return false;
}

export function hasChildTabs(parent) {
  if (!ensureLivingTab(parent))
    return false;
  return parent.hasAttribute(Constants.kCHILDREN);
}

export function getLabelWithDescendants(tab) {
  const label = [`* ${tab.dataset.label}`];
  for (const child of getChildTabs(tab)) {
    if (!child.dataset.labelWithDescendants)
      child.dataset.labelWithDescendants = getLabelWithDescendants(child);
    label.push(child.dataset.labelWithDescendants.replace(/^/gm, '  '));
  }
  return label.join('\n');
}

export function getMaxTreeLevel(hint, options = {}) {
  const tabs = options.onlyVisible ? getVisibleTabs(hint, { ordered: false }) : getTabs(hint, { ordered: false }) ;
  let maxLevel = Math.max(...tabs.map(tab => parseInt(tab.getAttribute(Constants.kLEVEL) || 0)));
  if (configs.maxTreeLevel > -1)
    maxLevel = Math.min(maxLevel, configs.maxTreeLevel);
  return maxLevel;
}

// if all tabs are aldeardy placed at there, we don't need to move them.
export function isAllTabsPlacedBefore(tabs, nextTab) {
  if (tabs[tabs.length - 1] == nextTab)
    nextTab = getNextTab(nextTab);
  if (!nextTab && !getNextTab(tabs[tabs.length - 1]))
    return true;

  tabs = Array.from(tabs);
  let previousTab = tabs.shift();
  for (const tab of tabs) {
    if (tab.previousSibling != previousTab)
      return false;
    previousTab = tab;
  }
  return !nextTab ||
         !previousTab ||
         getNextTab(previousTab) == nextTab;
}

export function isAllTabsPlacedAfter(tabs, previousTab) {
  if (tabs[0] == previousTab)
    previousTab = getPreviousTab(previousTab);
  if (!previousTab && !getPreviousTab(tabs[0]))
    return true;

  tabs = Array.from(tabs).reverse();
  let nextTab = tabs.shift();
  for (const tab of tabs) {
    if (getNextTab(tab) != nextTab)
      return false;
    nextTab = tab;
  }
  return !previousTab ||
         !nextTab ||
         nextTab.previousSibling == previousTab;
}


export function dumpAllTabs() {
  if (!configs.debug)
    return;
  log('dumpAllTabs\n' +
    getAllTabs().map(tab =>
      getAncestorTabs(tab).reverse().concat([tab])
        .map(tab => tab.id + (isPinned(tab) ? ' [pinned]' : ''))
        .join(' => ')
    ).join('\n'));
}


//===================================================================
// Promised status of tabs
//===================================================================

const mOpenedResolvers = new WeakMap();
const mClosedWhileActiveResolvers = new WeakMap();

export function initPromisedStatus(tab, alreadyOpened = false) {
  if (alreadyOpened)
    tab.opened = Promise.resolve(true);
  else
    tab.opened = new Promise((resolve, _aReject) => {
      mOpenedResolvers.set(tab, resolve);
    });

  tab.closedWhileActive = new Promise((resolve, _aReject) => {
    mClosedWhileActiveResolvers.set(tab, resolve);
  });
}

export function resolveOpened(tab) {
  if (!mOpenedResolvers.has(tab))
    return;
  mOpenedResolvers.get(tab)();
  mOpenedResolvers.delete(tab);
}

export function fetchClosedWhileActiveResolver(tab) {
  const resolver = mClosedWhileActiveResolvers.get(tab);
  mClosedWhileActiveResolvers.delete(tab);
  return resolver;
}


//===================================================================
// Tab State
//===================================================================

export async function addState(tab, state, options = {}) {
  if (!tab)
    return;
  tab.classList.add(state);
  if (tab.apiTab && tab.apiTab.$TSTStates)
    tab.apiTab.$TSTStates[state] = true;
  if (options.broadcast)
    broadcastState(tab, {
      add: [state]
    });
  if (options.permanently) {
    const states = await getPermanentStates(tab);
    if (!states.includes(state)) {
      states.push(state);
      await browser.sessions.setTabValue(tab.apiTab.id, Constants.kPERSISTENT_STATES, states);
    }
  }
}

export async function removeState(tab, state, options = {}) {
  if (!tab)
    return;
  tab.classList.remove(state);
  if (tab.apiTab && tab.apiTab.$TSTStates)
    delete tab.apiTab.$TSTStates[state];
  if (options.broadcast)
    broadcastState(tab, {
      remove: [state]
    });
  if (options.permanently) {
    const states = await getPermanentStates(tab);
    const index = states.indexOf(state);
    if (index > -1) {
      states.splice(index, 1);
      await browser.sessions.setTabValue(tab.apiTab.id, Constants.kPERSISTENT_STATES, states);
    }
  }
}

export function hasState(tab, state, options = {}) {
  if (options.attribute && tab)
    return tab.classList.contains(state);
  return tab && tab.apiTab && state in tab.apiTab.$TSTStates;
}

export function getStates(tab) {
  return tab && tab.apiTab && tab.apiTab.$TSTStates ? Object.keys(tab.apiTab.$TSTStates) : [];
}

export function broadcastState(tabs, options = {}) {
  if (!Array.isArray(tabs))
    tabs = [tabs];
  browser.runtime.sendMessage({
    type:    Constants.kCOMMAND_BROADCAST_TAB_STATE,
    tabs:    tabs.map(tab => tab.id),
    add:     options.add || [],
    remove:  options.remove || [],
    bubbles: !!options.bubbles
  });
}

export async function getPermanentStates(tab) {
  const states = await browser.sessions.getTabValue(tab.apiTab.id, Constants.kPERSISTENT_STATES);
  return states || [];
}

export async function setAttribute(tab, attribute, value) {
  if (!tab)
    return;
  tab.setAttribute(attribute, value);
  if (tab.apiTab)
    tab.apiTab.$TSTAttributes[attribute] = value;
}

export async function removeAttribute(tab, attribute) {
  if (!tab)
    return;
  tab.removeAttribute(attribute);
  if (tab.apiTab)
    delete tab.apiTab.$TSTAttributes[attribute];
}



//===================================================================
// Take snapshot
//===================================================================

export function snapshotTreeForActionDetection(targetTab) {
  const prevTab = getPreviousNormalTab(targetTab);
  const nextTab = getNextNormalTab(targetTab);
  const foundTabs = {};
  const tabs = getAncestorTabs(prevTab)
    .concat([prevTab, targetTab, nextTab, getParentTab(targetTab)])
    .filter(tab => ensureLivingTab(tab) && !foundTabs[tab.id] && (foundTabs[tab.id] = true)) // uniq
    .sort((aA, aB) => aA.apiTab.index - aB.apiTab.index);
  return snapshotTree(targetTab, tabs);
}

function snapshotTree(targetTab, tabs) {
  const allTabs = tabs || getTabs(targetTab);

  const snapshotById = {};
  function snapshotChild(tab) {
    if (!ensureLivingTab(tab) || isPinned(tab) || isHidden(tab))
      return null;
    return snapshotById[tab.id] = {
      id:            tab.id,
      url:           tab.apiTab.url,
      cookieStoreId: tab.apiTab.cookieStoreId,
      active:        isActive(tab),
      children:      getChildTabs(tab).filter(child => !isHidden(child)).map(child => child.id),
      collapsed:     isSubtreeCollapsed(tab),
      pinned:        isPinned(tab),
      level:         parseInt(tab.getAttribute(Constants.kLEVEL) || 0)
    };
  }
  const snapshotArray = allTabs.map(tab => snapshotChild(tab));
  for (const tab of allTabs) {
    const item = snapshotById[tab.id];
    if (!item)
      continue;
    const parent = getParentTab(tab);
    item.parent = parent && parent.id;
    const next = getNextNormalTab(tab);
    item.next = next && next.id;
    const previous = getPreviousNormalTab(tab);
    item.previous = previous && previous.id;
  }
  const activeTab = getActiveTab(targetTab);
  return {
    target:   snapshotById[targetTab.id],
    active:   activeTab && snapshotById[activeTab.id],
    tabs:     snapshotArray,
    tabsById: snapshotById
  };
}
