const toast = document.getElementById('toast');
const callerEl = document.getElementById('caller');
const numberEl = document.getElementById('number');
const noteEl = document.getElementById('note');
const copiedBadge = document.getElementById('copiedBadge');
const titleBarClose = document.getElementById('titleBarClose');
let currentPhoneNumber = '';

// Handle title bar close button
if (titleBarClose) {
  titleBarClose.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Close the toast window via IPC
    if (window.notificationAPI && window.notificationAPI.closeWindow) {
      window.notificationAPI.closeWindow();
    }
  });
}

// Handle window resize to adjust content
window.addEventListener('resize', () => {
  // Content will automatically adjust with CSS
  // Font sizes are set via inline styles from payload
});

const formatTime = (isoString) => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch (error) {
    return '';
  }
};

const updateTheme = (theme) => {
  document.body.dataset.theme = theme;
};

const clientInfoEl = document.getElementById('clientInfo');
const callerIdInfoEl = document.getElementById('callerIdInfo');

window.notificationAPI.onData((payload) => {
  // Display caller information - use client name from API if found, otherwise use caller ID
  const callerName = payload.callerLabel || 'Unknown caller';
  const phoneNum = payload.phoneNumber || 'No number';
  
  // Store phone number for clipboard copy (ensure we have a valid phone number)
  currentPhoneNumber = phoneNum;
  
  // Determine if we should use compact mode
  const hasAcuity = payload.acuityConfigured || payload.clientName || payload.appointmentTime;
  const isCompact = !hasAcuity;
  
  // Apply compact class to body
  if (isCompact) {
    document.body.classList.add('compact');
  } else {
    document.body.classList.remove('compact');
  }
  
  // Apply font settings for caller name (using Caller ID font settings)
  if (payload.callerIdFont) {
    callerEl.style.fontFamily = payload.callerIdFont;
  }
  if (payload.callerIdFontSize) {
    callerEl.style.fontSize = `${payload.callerIdFontSize}px`;
  }
  
  // Apply font settings for caller number
  if (payload.numberFont) {
    numberEl.style.fontFamily = payload.numberFont;
  }
  if (payload.numberFontSize) {
    numberEl.style.fontSize = `${payload.numberFontSize}px`;
  }
  
  // Batch DOM updates for better performance
  callerEl.textContent = callerName;
  numberEl.textContent = phoneNum;
  
  // Hide Caller ID info (feature removed)
  callerIdInfoEl.style.display = 'none';
  
  // Only show Acuity info (client name and appointment) if Acuity is enabled
  if (payload.acuityConfigured) {
    // Show client info above appointment time if found
    const hasClientInfo = payload.lookupState === 'match' && payload.clientName;
    if (hasClientInfo) {
      clientInfoEl.textContent = payload.clientName;
      clientInfoEl.style.display = 'block';
    } else {
      clientInfoEl.style.display = 'none';
    }
    
    // Display appointment time if available
    let noteText = '';
    if (payload.lookupState === 'match') {
      noteText = payload.appointmentTime 
        ? `Next: ${formatTime(payload.appointmentTime)}`
        : 'No upcoming appointment';
    } else {
      // Only show "Not in Acuity" if Acuity API is actually configured
      noteText = 'Not in Acuity';
    }
    
    noteEl.textContent = noteText;
  } else {
    // Acuity not enabled - hide all Acuity-related info
    clientInfoEl.style.display = 'none';
    noteEl.textContent = '';
  }

  toast.classList.remove('match', 'unknown');
  toast.classList.add(payload.lookupState === 'match' ? 'match' : 'unknown');
  updateTheme(payload.theme);
  toast.classList.add('visible');
});

// Copy phone number to clipboard and show badge
async function copyPhoneToClipboard() {
  if (!currentPhoneNumber || currentPhoneNumber === 'No number') {
    return false;
  }
  
  try {
    // Remove formatting for clipboard (just digits) - optimized regex
    const phoneDigits = currentPhoneNumber.replace(/\D/g, '');
    
    if (!phoneDigits || phoneDigits.length === 0) {
      return false;
    }
    
    // Check if badge element exists
    if (!copiedBadge) {
      return false;
    }
    
    // Use Electron's clipboard API via IPC
    const success = await window.notificationAPI.copyToClipboard(phoneDigits);
    
    if (success) {
      // Show copied badge
      copiedBadge.classList.add('visible');
      
      // Hide badge after 4 seconds (long enough to see)
      setTimeout(() => {
        copiedBadge.classList.remove('visible');
      }, 4000);
      
      return true;
    } else {
      // Still show badge even if clipboard failed
      copiedBadge.classList.add('visible');
      setTimeout(() => {
        copiedBadge.classList.remove('visible');
      }, 4000);
      return false;
    }
  } catch (error) {
    // Show badge even on error to indicate click was registered
    if (copiedBadge) {
      copiedBadge.classList.add('visible');
      setTimeout(() => {
        copiedBadge.classList.remove('visible');
      }, 4000);
    }
    return false;
  }
}

// Make entire toast clickable to copy phone (toast will follow timeout)
// Use event delegation for better performance
toast.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  
  // Copy phone number to clipboard
  const success = await copyPhoneToClipboard();
  
  // Notify main process of click event for logging
  if (window.notificationAPI.notifyClick) {
    window.notificationAPI.notifyClick(currentPhoneNumber, success);
  }
  
  // Don't hide toast immediately - let it follow the timeout setting
}, true); // Use capture phase for better performance

