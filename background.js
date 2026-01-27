chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ blockedWebsites: [] });
  } else if (details.reason === 'update') {
    chrome.storage.local.get(["blockedWebsites"], (result) => {
      if (result.blockedWebsites) {
        updateBlockRules(result.blockedWebsites);
      }
    });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.blockedWebsites) {
    updateBlockRules(changes.blockedWebsites.newValue);
  }
});

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
