const websiteInput = document.getElementById('websiteInput');
const addButton = document.getElementById('addButton');
const addCurrentPageBtn = document.getElementById('addCurrentPage');
const addCurrentSiteBtn = document.getElementById('addCurrentSite');
const blockedWebsitesList = document.getElementById('blockedWebsites');
const message = document.getElementById('message');

function showMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type}`;
  setTimeout(() => {
    message.className = 'message';
  }, 3000);
}

function loadBlockedWebsites() {
  chrome.storage.local.get(['blockedWebsites'], (result) => {
    const blockedWebsites = result.blockedWebsites || [];
    renderBlockedWebsites(blockedWebsites);
  });
}

function renderBlockedWebsites(blockedWebsites) {
  blockedWebsitesList.innerHTML = '';

  if (blockedWebsites.length === 0) {
    blockedWebsitesList.innerHTML = '<li class="empty-message">暂无屏蔽的网站</li>';
    return;
  }

  blockedWebsites.forEach((item, index) => {
    const li = document.createElement('li');
    const modeText = item.mode === 'domain' ? '整个域名' : '特定页面';
    li.innerHTML = `
      <div class="website-info">
        <span class="domain">${item.domain}</span>
        <span class="mode">${modeText}</span>
      </div>
      <button data-index="${index}">删除</button>
    `;
    blockedWebsitesList.appendChild(li);
  });

  document.querySelectorAll('#blockedWebsites button').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      removeWebsite(index);
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
      renderBlockedWebsites(blockedWebsites);
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
      renderBlockedWebsites(blockedWebsites);
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
        renderBlockedWebsites(blockedWebsites);
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
        renderBlockedWebsites(blockedWebsites);
      });
    });
  });
}

addButton.addEventListener('click', addWebsite);
addCurrentPageBtn.addEventListener('click', addCurrentPage);
addCurrentSiteBtn.addEventListener('click', addCurrentSite);

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
  loadBlockedWebsites();
  updatePlaceholder();
});