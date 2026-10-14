/* LaalPen website: the "Open app" buttons open the installed MOBILE app (never the web version). */
(function () {
  const cfg = window.LAALPEN || {};
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isPhone = isAndroid || isIOS;
  const pageUrl = location.origin + location.pathname;

  function storeLinks() {
    const links = [];
    if (isIOS) {
      if (cfg.appStoreUrl) links.push(['Download on the App Store', cfg.appStoreUrl]);
    } else if (isAndroid) {
      if (cfg.playStoreUrl) links.push(['Get it on Google Play', cfg.playStoreUrl]);
      if (cfg.apkUrl) links.push(['Download the Android app (APK)', cfg.apkUrl]);
    } else {
      if (cfg.playStoreUrl) links.push(['Google Play', cfg.playStoreUrl]);
      if (cfg.appStoreUrl) links.push(['App Store', cfg.appStoreUrl]);
      if (cfg.apkUrl) links.push(['Android APK', cfg.apkUrl]);
    }
    return links;
  }

  function renderLinks(el) {
    const links = storeLinks();
    el.innerHTML = '';
    if (!links.length) {
      const p = document.createElement('p');
      p.className = 'soon';
      p.textContent = 'The app is coming to the Play Store and App Store soon. Ask your school for the download link.';
      el.appendChild(p);
      return;
    }
    for (const [label, href] of links) {
      const a = document.createElement('a');
      a.className = 'btn btn-red';
      a.href = href;
      a.rel = 'noopener';
      a.textContent = label;
      el.appendChild(a);
    }
  }

  function showGetApp(text) {
    const d = document.getElementById('get-dialog');
    if (text) document.getElementById('get-text').textContent = text;
    renderLinks(document.getElementById('get-links'));
    if (!d.open) d.showModal();
  }

  /** If the page is still visible after a moment, the app did not open. */
  function fallbackIfStillHere(ms, action) {
    let left = false;
    const onHide = () => { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => (left = true), { once: true });
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!left && !document.hidden) action();
    }, ms);
  }

  function openApp() {
    if (isAndroid) {
      // Chrome opens the app if installed, otherwise goes to the fallback URL itself
      const fallback = cfg.playStoreUrl || cfg.apkUrl || pageUrl + '?getapp=1';
      location.href =
        'intent://open#Intent;scheme=' + cfg.appScheme + ';package=' + cfg.androidPackage +
        ';S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';
      fallbackIfStillHere(2200, () => showGetApp());
      return;
    }
    if (isIOS) {
      location.href = cfg.appScheme + '://';
      fallbackIfStillHere(1600, () => (cfg.appStoreUrl ? (location.href = cfg.appStoreUrl) : showGetApp()));
      return;
    }
    // computer: there is no mobile app here, so show a code to open it on the phone
    const d = document.getElementById('open-dialog');
    const holder = document.getElementById('qr');
    holder.innerHTML = '';
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(pageUrl + '?open=1');
      qr.make();
      holder.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }
    renderLinks(document.getElementById('store-links'));
    d.showModal();
  }

  document.querySelectorAll('[data-open-app]').forEach((b) => b.addEventListener('click', openApp));

  // contact links
  document.querySelectorAll('[data-contact]').forEach((a) => {
    a.href = cfg.contactWhatsApp ? 'https://wa.me/' + cfg.contactWhatsApp : 'mailto:' + (cfg.contactEmail || '');
  });

  // arrived from the QR code on a phone: browsers need a tap before opening another app
  const params = new URLSearchParams(location.search);
  if (params.get('open') === '1' && isPhone) {
    const d = document.getElementById('get-dialog');
    document.getElementById('get-title').textContent = 'Open LaalPen';
    document.getElementById('get-text').textContent = 'Tap the button to open the app on this phone.';
    const links = document.getElementById('get-links');
    links.innerHTML = '';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-red';
    b.textContent = 'Open the app';
    b.addEventListener('click', () => { d.close(); openApp(); });
    links.appendChild(b);
    d.showModal();
  }
  if (params.get('getapp') === '1') showGetApp('Install LaalPen to continue.');

  // the hero copy gets "checked" once it is on screen
  const sheet = document.querySelector('.copy-sheet');
  if (sheet) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        sheet.classList.add('go');
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(sheet);
  }
})();
