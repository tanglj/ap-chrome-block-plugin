const websiteInput = document.getElementById('websiteInput');
const addButton = document.getElementById('addButton');
const addCurrentPageBtn = document.getElementById('addCurrentPage');
const addCurrentSiteBtn = document.getElementById('addCurrentSite');
const selectElementBtn = document.getElementById('selectElement');
const blockedItemsList = document.getElementById('blockedItems');
const message = document.getElementById('message');

function showMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type}`;
  setTimeout(() => {
    message.className = 'message';
  }, 3000);
}

function loadBlockedItems() {
  chrome.storage.local.get(['blockedWebsites', 'blockedElements'], (result) => {
    const blockedWebsites = result.blockedWebsites || [];
    const blockedElements = result.blockedElements || [];
    renderBlockedItems(blockedWebsites, blockedElements);
  });
}

function renderBlockedItems(blockedWebsites, blockedElements) {
  blockedItemsList.innerHTML = '';
  
  getCurrentTabUrl((currentUrl) => {
    if (!currentUrl) {
      blockedItemsList.innerHTML = '<li class="empty-message">无法获取当前页面</li>';
      return;
    }

    const currentDomain = extractDomain(currentUrl);
    const currentPath = new URL(currentUrl).pathname + new URL(currentUrl).search + new URL(currentUrl).hash;
    let hasItems = false;

    // 显示屏蔽的网站
    blockedWebsites.forEach((item, index) => {
      if (item.domain === currentDomain) {
        hasItems = true;
        const li = document.createElement('li');
        const modeText = item.mode === 'domain' ? '整个域名' : '特定页面';
        const typeClass = item.mode === 'domain' ? 'type-domain' : 'type-page';
        
        li.innerHTML = `
          <div class="item-info">
            <span class="item-type ${typeClass}">${modeText}</span>
            <span class="item-domain">${item.domain}</span>
            ${item.mode === 'page' ? `<span class="item-path">${item.original}</span>` : ''}
          </div>
          <button data-type="website" data-index="${index}">删除</button>
        `;
        blockedItemsList.appendChild(li);
      }
    });

    // 显示屏蔽的元素
    blockedElements.forEach((item, index) => {
      if (item.domain === currentDomain) {
        hasItems = true;
        const li = document.createElement('li');
        
        li.innerHTML = `
          <div class="item-info">
            <span class="item-type type-element">元素</span>
            <span class="item-selector">${item.selector}</span>
          </div>
          <button data-type="element" data-index="${index}">删除</button>
        `;
        blockedItemsList.appendChild(li);
      }
    });

    if (!hasItems) {
      blockedItemsList.innerHTML = '<li class="empty-message">当前页面无屏蔽内容</li>';
    }

    document.querySelectorAll('#blockedItems button').forEach(button => {
      button.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        const index = parseInt(e.target.dataset.index);
        if (type === 'website') {
          removeWebsite(index);
        } else if (type === 'element') {
          removeBlockedElement(index);
        }
      });
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

function getSelectedMode() {
  const selected = document.querySelector('input[name="blockMode"]:checked');
  return selected ? selected.value : 'domain';
}

function addWebsite() {
  const website = websiteInput.value.trim();

  if (!website) {
    showMessage('请输入网站域名或页面URL', 'error');
    return;
  }

  const mode = getSelectedMode();
  const domain = extractDomain(website);

  chrome.storage.local.get(['blockedWebsites'], (result) => {
    let blockedWebsites = result.blockedWebsites || [];

    const existingIndex = blockedWebsites.findIndex(item => item.domain === domain);
    
    if (existingIndex !== -1) {
      showMessage('该网站已在屏蔽列表中', 'error');
      return;
    }

    blockedWebsites.push({
      domain: domain,
      mode: mode,
      original: website
    });

    chrome.storage.local.set({ blockedWebsites }, () => {
      showMessage('网站已添加到屏蔽列表', 'success');
      websiteInput.value = '';
      loadBlockedItems();
    });
  });
}

function removeWebsite(index) {
  chrome.storage.local.get(['blockedWebsites'], (result) => {
    let blockedWebsites = result.blockedWebsites || [];
    const removedItem = blockedWebsites[index];
    
    blockedWebsites.splice(index, 1);
    chrome.storage.local.set({ blockedWebsites }, () => {
      showMessage(`已移除网站: ${removedItem.domain}`, 'success');
      loadBlockedItems();
    });
  });
}

function getCurrentTabUrl(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      callback(tabs[0].url);
    } else {
      callback(null);
    }
  });
}

function addCurrentPage() {
  getCurrentTabUrl((url) => {
    if (!url) {
      showMessage('无法获取当前页面URL', 'error');
      return;
    }

    const domain = extractDomain(url);
    const path = new URL(url).pathname + new URL(url).search + new URL(url).hash;

    chrome.storage.local.get(['blockedWebsites'], (result) => {
      let blockedWebsites = result.blockedWebsites || [];

      const existingIndex = blockedWebsites.findIndex(item => 
        item.domain === domain && item.mode === 'page' && item.original === url
      );
      
      if (existingIndex !== -1) {
        showMessage('该页面已在屏蔽列表中', 'error');
        return;
      }

      blockedWebsites.push({
        domain: domain,
        mode: 'page',
        original: url
      });

      chrome.storage.local.set({ blockedWebsites }, () => {
        showMessage('当前页面已添加到屏蔽列表', 'success');
        loadBlockedItems();
      });
    });
  });
}

function addCurrentSite() {
  getCurrentTabUrl((url) => {
    if (!url) {
      showMessage('无法获取当前网站域名', 'error');
      return;
    }

    const domain = extractDomain(url);

    chrome.storage.local.get(['blockedWebsites'], (result) => {
      let blockedWebsites = result.blockedWebsites || [];

      const existingIndex = blockedWebsites.findIndex(item => 
        item.domain === domain && item.mode === 'domain'
      );
      
      if (existingIndex !== -1) {
        showMessage('该网站已在屏蔽列表中', 'error');
        return;
      }

      blockedWebsites.push({
        domain: domain,
        mode: 'domain',
        original: url
      });

      chrome.storage.local.set({ blockedWebsites }, () => {
        showMessage('当前网站已添加到屏蔽列表', 'success');
        loadBlockedItems();
      });
    });
  });
}

addButton.addEventListener('click', addWebsite);
addCurrentPageBtn.addEventListener('click', addCurrentPage);
addCurrentSiteBtn.addEventListener('click', addCurrentSite);
selectElementBtn.addEventListener('click', startElementSelection);

websiteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addWebsite();
  }
});

function updatePlaceholder() {
  const mode = getSelectedMode();
  websiteInput.placeholder = mode === 'domain' 
    ? '输入网站域名 (例如: example.com)' 
    : '输入页面URL (例如: https://example.com/specific/page)';
}

document.querySelectorAll('input[name="blockMode"]').forEach(radio => {
  radio.addEventListener('change', updatePlaceholder);
});

document.addEventListener('DOMContentLoaded', () => {
  loadBlockedItems();
  updatePlaceholder();
});

function startElementSelection() {
  getCurrentTabUrl((url) => {
    if (!url) {
      showMessage('无法获取当前页面URL', 'error');
      return;
    }

    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      showMessage('无法在系统页面选择元素', 'error');
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        const tabId = tabs[0].id;
        
        // 检查页面是否完全加载
        if (tabs[0].status !== 'complete') {
          showMessage('页面加载中，请稍后再试', 'error');
          return;
        }

        // 尝试发送消息到content script
        chrome.tabs.sendMessage(tabId, { action: 'startSelectMode' }, (response) => {
          if (chrome.runtime.lastError) {
            // content script未响应，尝试重新注入
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                showMessage('无法启动元素选择模式: ' + chrome.runtime.lastError.message, 'error');
              } else {
                // 重新注入后再次尝试发送消息
                setTimeout(() => {
                  chrome.tabs.sendMessage(tabId, { action: 'startSelectMode' }, (response) => {
                    if (chrome.runtime.lastError) {
                      showMessage('无法启动元素选择模式', 'error');
                    } else {
                      window.close();
                    }
                  });
                }, 100);
              }
            });
          } else {
            window.close();
          }
        });
      }
    });
  });
}

function removeBlockedElement(index) {
  chrome.storage.local.get(['blockedElements'], (result) => {
    let blockedElements = result.blockedElements || [];
    const removedItem = blockedElements[index];
    
    blockedElements.splice(index, 1);
    chrome.storage.local.set({ blockedElements }, () => {
      showMessage(`已移除屏蔽元素: ${removedItem.selector}`, 'success');
      loadBlockedItems();
      
      // 通知content script更新屏蔽规则
      getCurrentTabUrl((url) => {
        const currentDomain = extractDomain(url);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { 
              action: 'applyBlockRules',
              selectors: blockedElements.filter(item => item.domain === currentDomain).map(item => item.selector)
            });
          }
        });
      });
    });
  });
}