// Runs only on Fontexto's own pages (see manifest "matches"). Tells the page the extension is installed and relays
// its requests: the page can only ask for a DOI, and only gets back a PDF.
(() => {
  const PAGE = 'fontexto-page';
  const EXT = 'fontexto-ext';
  document.documentElement.setAttribute('data-fontexto-ext', chrome.runtime.getManifest().version);

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const m = event.data;
    if (!m || m.source !== PAGE || m.type !== 'fetch' || typeof m.id !== 'string' || typeof m.doi !== 'string') return;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'fetch', doi: m.doi });
    } catch {
      res = { ok: false };
    }
    window.postMessage({ source: EXT, type: 'result', id: m.id, ok: Boolean(res && res.ok), pdf: res && res.ok ? res.pdf : undefined }, window.location.origin);
  });
})();
