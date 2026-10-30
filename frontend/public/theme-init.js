// Themes the page before it is drawn, so that a person who chose (or whose device asks for) a dark or
// high-contrast appearance does not see a flash of the light one. It is a separate file, not inline,
// because the page's content security policy allows scripts from this origin only. The rule here is
// the same as `resolveTheme` in src/lib/theme.ts, and a test runs both against the same cases.
(function () {
  var THEMES = ['light', 'dark', 'high-contrast'];
  var COLORS = { light: '#ffffff', dark: '#1c1f24', 'high-contrast': '#000000' };
  var theme = 'light';
  try {
    var stored = null;
    try {
      stored = window.localStorage.getItem('swarm.theme');
    } catch {
      stored = null;
    }
    if (THEMES.indexOf(stored) >= 0) {
      theme = stored;
    } else if (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) {
      theme = 'high-contrast';
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    }
  } catch {
    theme = 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS[theme]);
})();
