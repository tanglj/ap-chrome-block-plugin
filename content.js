let isSelectMode = false;
let currentHighlightElement = null;
let blockedSelectors = [];
let escapeHandler = null;
let blockObserver = null;
let applyRulesTimer = null;
let contextTornDown = false;

// 调用任何 chrome.* API 前检查扩展上下文是否仍然有效。
// 扩展被重新加载/更新/停用后，残留的旧内容脚本中 chrome.runtime.id 会消失，
// 此时调用 chrome.storage 等会抛出 "Extension context invalidated."
function isExtensionContextAlive() {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// 上下文失效后彻底停掉旧脚本：断开 MutationObserver、清除定时器、退出选择模式，
// 避免页面后续 DOM 变化再次触发对已失效 API 的调用。
function teardownStaleScript() {
  if (contextTornDown) return;
  contextTornDown = true;

  if (applyRulesTimer !== null) {
    clearTimeout(applyRulesTimer);
    applyRulesTimer = null;
  }
  if (blockObserver) {
    blockObserver.disconnect();
    blockObserver = null;
  }
  stopSelectMode();

  console.debug('[TBlock] 扩展已重新加载或停用，旧内容脚本已停止工作，刷新页面即可恢复。');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isExtensionContextAlive()) {
    teardownStaleScript();
    return false;
  }
  if (request.action === 'startSelectMode') {
    startSelectMode();
    sendResponse({ success: true });
  } else if (request.action === 'stopSelectMode') {
    stopSelectMode();
    sendResponse({ success: true });
  } else if (request.action === 'applyBlockRules') {
    blockedSelectors = request.selectors || [];
    applyBlockRules();
    sendResponse({ success: true });
  } else if (request.action === 'getBlockRules') {
    sendResponse({ selectors: blockedSelectors });
  }
});

function startSelectMode() {
  if (isSelectMode) return;
  
  console.log('Starting select mode');
  isSelectMode = true;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  document.addEventListener('click', handleClick, true);
  
  showSelectModeTip();
}

function stopSelectMode() {
  if (!isSelectMode) return;
  
  console.log('Stopping select mode');
  isSelectMode = false;
  document.body.style.cursor = '';
  document.removeEventListener('mouseover', handleMouseOver, true);
  document.removeEventListener('mouseout', handleMouseOut, true);
  document.removeEventListener('click', handleClick, true);
  
  // 移除ESC键监听器（同时移除document和window上的监听器）
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    window.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
  
  if (currentHighlightElement) {
    currentHighlightElement.style.outline = '';
    currentHighlightElement = null;
  }
  
  removeSelectModeTip();
}

function handleMouseOver(e) {
  if (!isSelectMode) return;
  
  const element = e.target;
  
  if (element === currentHighlightElement) return;
  
  if (currentHighlightElement) {
    currentHighlightElement.style.outline = '';
  }
  
  currentHighlightElement = element;
  element.style.outline = '3px solid #dc3545';
  e.stopPropagation();
}

function handleMouseOut(e) {
  if (!isSelectMode) return;
  
  const element = e.target;
  
  if (element === currentHighlightElement) {
    element.style.outline = '';
    currentHighlightElement = null;
  }
}

function handleClick(e) {
  if (!isSelectMode) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const element = e.target;
  const selector = getSelector(element);
  
  // 获取域名而不是完整URL
  const domain = window.location.hostname.replace(/^www\./, '');
  
  const rule = {
    action: 'addBlockRule',
    selector: selector,
    domain: domain
  };

  try {
    chrome.runtime.sendMessage(rule, (response) => {
      if (!chrome.runtime.lastError && response && response.success) {
        showSuccessMessage(`已屏蔽元素: ${selector}`);
        applyBlockRules();
        return;
      }

      // Service workers can be restarting while a content script is active.
      // Persist the rule locally so a transient messaging failure does not lose it.
      if (chrome.runtime.lastError) {
        saveBlockRuleLocally(rule);
      } else if (response && response.message) {
        showSuccessMessage(response.message);
      }
    });
  } catch (e) {
    // 扩展刚被重新加载/停用时，sendMessage 会同步抛出 "Extension context invalidated."
    // 降级为本地保存；若 storage 也不可用，saveBlockRuleLocally 会安全退出。
    saveBlockRuleLocally(rule);
  }
  
  stopSelectMode();
}

function getSelector(element) {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      return classes.map(className => `.${CSS.escape(className)}`).join('');
    }
  }
  
  let path = [];
  let current = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector += `#${CSS.escape(current.id)}`;
      path.unshift(selector);
      break;
    }
    
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(' ').filter(c => c.trim());
      if (classes.length > 0) {
        selector += `.${CSS.escape(classes[0])}`;
      }
    }
    
    const siblings = Array.from(current.parentNode.children);
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }
    
    path.unshift(selector);
    current = current.parentNode;
  }
  
  return path.join(' > ') || 'body';
}

function saveBlockRuleLocally(rule) {
  if (!isExtensionContextAlive()) {
    teardownStaleScript();
    return;
  }
  chrome.storage.local.get(['blockedElements'], (result) => {
    const blockedElements = result.blockedElements || [];
    const exists = blockedElements.some(item =>
      item.domain === rule.domain && item.selector === rule.selector
    );
    if (exists) {
      showSuccessMessage('该元素已在屏蔽列表中');
      return;
    }

    blockedElements.push({ domain: rule.domain, selector: rule.selector, count: 1 });
    chrome.storage.local.set({ blockedElements }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving block rule:', chrome.runtime.lastError.message);
        return;
      }
      showSuccessMessage(`已屏蔽元素: ${rule.selector}`);
      applyBlockRules();
    });
  });
}

function applyBlockRules() {
  if (!isExtensionContextAlive()) {
    teardownStaleScript();
    return;
  }
  chrome.storage.local.get(['blockedElements'], (result) => {
    const blockedElements = result.blockedElements || [];
    const currentDomain = window.location.hostname.replace(/^www\./, '');
    
    blockedElements.forEach(item => {
      if (item.domain === currentDomain) {
        try {
          const elements = document.querySelectorAll(item.selector);
          elements.forEach(el => {
            el.style.display = 'none';
            el.setAttribute('data-blocked', 'true');
          });
        } catch (e) {
          console.error('Error applying block rule:', e);
        }
      }
    });
  });
}

function scheduleApplyBlockRules() {
  if (applyRulesTimer !== null) {
    clearTimeout(applyRulesTimer);
  }

  applyRulesTimer = setTimeout(() => {
    applyRulesTimer = null;
    applyBlockRules();
  }, 50);
}

function observeDynamicContent() {
  if (blockObserver || !document.body || typeof MutationObserver === 'undefined') {
    return;
  }

  blockObserver = new MutationObserver((mutations) => {
    // Only rescan when nodes were added. Style changes made by us do not retrigger this observer.
    if (mutations.some(mutation => mutation.addedNodes.length > 0)) {
      scheduleApplyBlockRules();
    }
  });

  blockObserver.observe(document.body, { childList: true, subtree: true });
}

function showSelectModeTip() {
  const tip = document.createElement('div');
  tip.id = 'tblock-select-tip';
  tip.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #dc3545;
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: bold;
    z-index: 2147483647;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    pointer-events: none;
  `;
  tip.textContent = '点击要屏蔽的元素，按 ESC 取消';
  document.body.appendChild(tip);
  
  // 确保先移除旧的监听器
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    window.removeEventListener('keydown', escapeHandler, true);
  }
  
  escapeHandler = (e) => {
    // 兼容不同的按键事件
    if ((e.key === 'Escape' || e.keyCode === 27 || e.which === 27) && isSelectMode) {
      console.log('ESC key pressed, stopping select mode');
      e.preventDefault();
      e.stopPropagation();
      stopSelectMode();
    }
  };
  
  // 同时在document和window上添加监听器
  document.addEventListener('keydown', escapeHandler, true);
  window.addEventListener('keydown', escapeHandler, true);
  console.log('ESC handler added on both document and window');
}

function removeSelectModeTip() {
  const tip = document.getElementById('tblock-select-tip');
  if (tip) {
    tip.remove();
  }
}

function showSuccessMessage(message) {
  const msg = document.createElement('div');
  msg.id = 'tblock-success-msg';
  msg.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #28a745;
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: bold;
    z-index: 2147483647;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  msg.textContent = message;
  document.body.appendChild(msg);
  
  setTimeout(() => {
    msg.remove();
  }, 3000);
}

// 页面加载时应用已有的屏蔽规则
console.log(`[TBlock] content script v${chrome.runtime.getManifest().version} loaded`);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyBlockRules();
    observeDynamicContent();
  }, { once: true });
} else {
  applyBlockRules();
  observeDynamicContent();
}
