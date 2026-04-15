let isSelectMode = false;
let currentHighlightElement = null;
let blockedSelectors = [];
let escapeHandler = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleClick);
  
  showSelectModeTip();
}

function stopSelectMode() {
  if (!isSelectMode) return;
  
  console.log('Stopping select mode');
  isSelectMode = false;
  document.body.style.cursor = '';
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleClick);
  
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
  
  chrome.runtime.sendMessage({
    action: 'addBlockRule',
    selector: selector,
    domain: domain
  }, (response) => {
    if (response && response.success) {
      showSuccessMessage(`已屏蔽元素: ${selector}`);
      applyBlockRules();
    }
  });
  
  stopSelectMode();
}

function getSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }
  
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      return `.${classes.join('.')}`;
    }
  }
  
  let path = [];
  let current = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }
    
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(' ').filter(c => c.trim());
      if (classes.length > 0) {
        selector += `.${classes[0]}`;
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
  
  return path.join(' > ');
}

function applyBlockRules() {
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyBlockRules);
} else {
  applyBlockRules();
}