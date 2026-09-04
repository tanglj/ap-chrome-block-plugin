chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ blockedWebsites: [], blockedElements: [] });
  } else if (details.reason === 'update') {
    chrome.storage.local.get(["blockedWebsites"], (result) => {
      if (result.blockedWebsites) {
        updateBlockRules(result.blockedWebsites);
        updateAllTabsIcons();
      }
    });
    chrome.storage.local.get(["blockedElements"], (result) => {
      if (!result.blockedElements) {
        chrome.storage.local.set({ blockedElements: [] });
      } else {
        updateAllTabsElementStyles(result.blockedElements);
      }
    });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") {
    return;
  }

  if (changes.blockedWebsites) {
    updateBlockRules(changes.blockedWebsites.newValue);
    updateAllTabsIcons();
  }

  if (changes.blockedElements) {
    updateAllTabsElementStyles(changes.blockedElements.newValue || []);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateTabIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    injectElementStyles(tabId, tab.url);
  }

  if (changeInfo.status === 'complete' && tab.url) {
    updateTabIcon(tabId);
  }
});

const injectedElementCss = new Map();

function buildElementCss(blockedElements, url) {
  const domain = extractDomain(url);
  const selectors = blockedElements
    .filter(item => item.domain === domain && item.selector)
    .map(item => item.selector.trim())
    .filter(Boolean);

  if (selectors.length === 0) {
    return '';
  }

  return `${selectors.join(',\n')} { display: none !important; }`;
}

function injectElementStyles(tabId, url, blockedElements) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  const apply = (rules) => {
    const css = buildElementCss(rules, url);
    const previousCss = injectedElementCss.get(tabId);
    const insert = () => {
      if (!css) {
        injectedElementCss.delete(tabId);
        return;
      }

      console.log('[TBlock] 元素 CSS 注入开始', { tabId, url, css });
      chrome.scripting.insertCSS({ target: { tabId }, css }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[TBlock] 元素 CSS 注入失败', {
            tabId,
            url,
            error: chrome.runtime.lastError.message
          });
          return;
        }
        console.log('[TBlock] 元素 CSS 注入成功', { tabId, url });
        injectedElementCss.set(tabId, css);
      });
    };

    if (previousCss) {
      chrome.scripting.removeCSS({ target: { tabId }, css: previousCss }, () => {
        void chrome.runtime.lastError;
        insert();
      });
    } else {
      insert();
    }
  };

  if (blockedElements) {
    apply(blockedElements);
  } else {
    chrome.storage.local.get(['blockedElements'], result => {
      apply(result.blockedElements || []);
    });
  }
}

function updateAllTabsElementStyles(blockedElements) {
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      if (tab.id && tab.url) {
        injectElementStyles(tab.id, tab.url, blockedElements);
      }
    });
  });
}

function extractDomain(url) {
  try {
    let domain = url.trim();
    
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      const urlObj = new URL(domain);
      domain = urlObj.hostname;
    }
    
    domain = domain.replace(/^www\./, '');
    
    return domain;
  } catch (e) {
    return url.trim();
  }
}

function extractPathFromUrl(url) {
  try {
    let urlObj = new URL(url);
    let path = urlObj.pathname;
    if (urlObj.search) {
      path += urlObj.search;
    }
    if (urlObj.hash) {
      path += urlObj.hash;
    }
    return path || '/';
  } catch (e) {
    return '';
  }
}

async function updateBlockRules(blockedWebsites) {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map(rule => rule.id);

    if (ruleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (blockedWebsites && blockedWebsites.length > 0) {
      const newRules = [];

      blockedWebsites.forEach((item, index) => {
        const ruleId = index + 1;
        
        if (item.mode === 'domain') {
          newRules.push({
            id: ruleId,
            priority: 1,
            action: {
              type: "block"
            },
            condition: {
              urlFilter: `||${item.domain}^`,
              resourceTypes: ["main_frame", "sub_frame"]
            }
          });
        } else if (item.mode === 'page') {
          const path = extractPathFromUrl(item.original);
          newRules.push({
            id: ruleId,
            priority: 1,
            action: {
              type: "block"
            },
            condition: {
              regexFilter: `^https?://(www\\.)?${item.domain.replace(/\./g, '\\.')}${path.replace(/([.+?^${}()|[\]\\])/g, '\\$1')}$`,
              resourceTypes: ["main_frame", "sub_frame"]
            }
          });
        }
      });

      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: newRules
      });
    }
  } catch (error) {
    console.error('Error in updateBlockRules:', error);
  }
}

function isUrlBlocked(url, blockedWebsites) {
  if (!url || !blockedWebsites || blockedWebsites.length === 0) {
    return false;
  }

  try {
    const urlObj = new URL(url);
    const currentDomain = urlObj.hostname.replace(/^www\./, '');
    const currentPath = urlObj.pathname + urlObj.search + urlObj.hash;

    for (const item of blockedWebsites) {
      if (item.mode === 'domain' && item.domain === currentDomain) {
        return true;
      } else if (item.mode === 'page') {
        const blockedPath = extractPathFromUrl(item.original);
        if (item.domain === currentDomain && blockedPath === currentPath) {
          return true;
        }
      }
    }
  } catch (e) {
    console.error('Error parsing URL:', e);
  }

  return false;
}

function updateTabIcon(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) {
      return;
    }

    chrome.storage.local.get(['blockedWebsites'], (result) => {
      const blockedWebsites = result.blockedWebsites || [];
      const isBlocked = isUrlBlocked(tab.url, blockedWebsites);

      if (isBlocked) {
        chrome.action.setBadgeText({
          text: 'B',
          tabId: tabId
        });
        chrome.action.setBadgeBackgroundColor({
          color: '#dc3545',
          tabId: tabId
        });
        chrome.action.setBadgeTextColor({
          color: '#ffffff',
          tabId: tabId
        });
      } else {
        chrome.action.setBadgeText({
          text: '',
          tabId: tabId
        });
      }
    });
  });
}

function updateAllTabsIcons() {
  chrome.tabs.query({}, (tabs) => {
    chrome.storage.local.get(['blockedWebsites'], (result) => {
      const blockedWebsites = result.blockedWebsites || [];

      tabs.forEach(tab => {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          const isBlocked = isUrlBlocked(tab.url, blockedWebsites);

          if (isBlocked) {
            chrome.action.setBadgeText({
              text: 'B',
              tabId: tab.id
            });
            chrome.action.setBadgeBackgroundColor({
              color: '#dc3545',
              tabId: tab.id
            });
            chrome.action.setBadgeTextColor({
              color: '#ffffff',
              tabId: tab.id
            });
          } else {
            chrome.action.setBadgeText({
              text: '',
              tabId: tab.id
            });
          }
        }
      });
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addBlockRule') {
    chrome.storage.local.get(['blockedElements'], (result) => {
      let blockedElements = result.blockedElements || [];
      
      const existingIndex = blockedElements.findIndex(item => 
        item.domain === request.domain && item.selector === request.selector
      );
      
      if (existingIndex !== -1) {
        sendResponse({ success: false, message: '该元素已在屏蔽列表中' });
        return;
      }
      
      blockedElements.push({
        domain: request.domain,
        selector: request.selector,
        count: 1
      });
      
      chrome.storage.local.set({ blockedElements }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
});
