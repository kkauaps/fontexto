// Pre-paint boot: language and theme before the app bundle loads.
// External file (not inline) so the strict CSP (script-src 'self', no 'unsafe-inline') allows it.
(function () {
  var map = { en: 'en', 'en-us': 'en', 'en-gb': 'en', es: 'es', 'es-es': 'es', 'es-mx': 'es', 'es-ar': 'es', ru: 'ru', 'ru-ru': 'ru', pt: 'pt-BR', 'pt-br': 'pt-BR', 'pt-pt': 'pt-BR' };
  var q = new URLSearchParams(location.search).get('lang');
  var storedLang = null;
  try { storedLang = localStorage.getItem('fontexto:lang'); } catch (e) {}
  var lang = map[String(q || storedLang || 'en').toLowerCase()] || 'en';
  document.documentElement.lang = lang;
  var boot = { en: 'Loading Fontexto…', es: 'Cargando Fontexto…', ru: 'Загрузка Fontexto…', 'pt-BR': 'Carregando o Fontexto…' };
  var el = document.querySelector('#root .boot p');
  if (el) el.textContent = boot[lang] || boot.en;
  var themes = { glass: 1, 'dark-solid': 1, light: 1 };
  var theme = 'light';
  var accent = 'emerald';
  try {
    var raw = localStorage.getItem('fontexto.appearance');
    if (raw) {
      var a = JSON.parse(raw);
      if (a && themes[a.theme]) theme = a.theme;
      if (a && typeof a.accent === 'string' && a.accent) accent = a.accent;
    }
  } catch (e) {}
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-accent', accent);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ECEEF1' : theme === 'dark-solid' ? '#121417' : '#10141C');
})();
