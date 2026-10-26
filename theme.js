(() => {
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  const storageKey = 'epub-pdf-studio-theme';
  const choices = ['auto', 'light', 'dark'];
  let selected = 'auto';

  try {
    const saved = localStorage.getItem(storageKey);
    if (choices.includes(saved)) selected = saved;
  } catch {
    // Theme selection still works when browser storage is unavailable.
  }

  function applyTheme(save = false) {
    const resolved = selected === 'auto' ? (systemTheme?.matches ? 'dark' : 'light') : selected;
    root.dataset.themeMode = selected;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    if (themeMeta) themeMeta.content = resolved === 'dark' ? '#0c1321' : '#f7f8fb';

    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === selected));
    });

    if (save) {
      try {
        localStorage.setItem(storageKey, selected);
      } catch {
        // The active theme remains applied for this visit.
      }
    }
  }

  applyTheme();

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => {
        selected = choices.includes(button.dataset.themeChoice) ? button.dataset.themeChoice : 'auto';
        applyTheme(true);
      });
    });
    applyTheme();
  });

  if (systemTheme?.addEventListener) {
    systemTheme.addEventListener('change', () => {
      if (selected === 'auto') applyTheme();
    });
  } else {
    systemTheme?.addListener?.(() => {
      if (selected === 'auto') applyTheme();
    });
  }
})();
