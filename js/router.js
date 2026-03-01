/* router.js – Simple Hash Router */
export function initRouter(onRoute) {
  window.addEventListener('hashchange', () => onRoute(parseHash()));
  if (!window.location.hash) {
    window.location.hash = '#home';
  } else {
    onRoute(parseHash());
  }
}

function parseHash() {
  const hash = window.location.hash.replace('#', '');
  const parts = hash.split('/');
  return { page: parts[0] || 'home', param: parts[1] || null, sub: parts[2] || null };
}

export function navigate(page) {
  window.location.hash = '#' + page;
}
