// Popup: optional library proxy prefix (EZproxy or similar), kept in this browser's extension storage.
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = chrome.i18n.getMessage(el.getAttribute('data-i18n'));

const input = document.getElementById('prefix');
const status = document.getElementById('status');

function valid(raw) {
  const v = raw.trim();
  if (!v) return '';
  if (/\s/.test(v) || v.length > 500) return undefined;
  try {
    const u = new URL(v.replace(/\{(url|doi)\}/g, 'x'));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    if (u.username || u.password) return undefined;
  } catch {
    return undefined;
  }
  return v;
}

chrome.storage.sync.get('libraryPrefix').then(({ libraryPrefix }) => {
  input.value = libraryPrefix || '';
});

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = valid(input.value);
  if (v === undefined) {
    status.textContent = chrome.i18n.getMessage('invalid');
    status.className = 'bad';
    return;
  }
  if (v) await chrome.storage.sync.set({ libraryPrefix: v });
  else await chrome.storage.sync.remove('libraryPrefix');
  status.textContent = chrome.i18n.getMessage('saved');
  status.className = 'ok';
});
