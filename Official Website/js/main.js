/* ==========================================================================
   Novaris Browser — official site
   No framework, no build step, no third-party requests.

   The one piece of real logic here reads the published update feed so the page
   states the version, size and hash that are genuinely live rather than values
   typed into the markup and left to rot. It has to survive three situations:
   the feed is reachable, the feed is blocked by the browser, and the feed is
   reachable but says something unexpected. None of them should leave a broken
   page or a false claim behind.
   ========================================================================== */

(function () {
  'use strict';

  // Where the installer and its manifest are published. Changing this is the
  // only thing needed to point the site at a different domain.
  var FEED = 'https://updates.yladevs.com/latest.yml';
  // The release the written content on this page describes. It is not assumed
  // to be the published one: the feed decides, and a mismatch is stated rather
  // than hidden.
  var NOTES_VERSION = '0.7.5';
  var FALLBACK_VERSION = '0.7.5';
  var FALLBACK_BYTES = 114415662;

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  /* ---------------------------------------------------------------------
     Feed parsing
     A deliberately small reader: the file is machine generated, so this looks
     for the three fields the site actually shows and ignores the rest.
     --------------------------------------------------------------------- */

  function parseFeed(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    var version = (text.match(/^version:\s*(\S+)\s*$/m) || [])[1];
    var file = (text.match(/^\s*-?\s*url:\s*(\S+)/m) || [])[1];
    var hash = (text.match(/^sha512:\s*(\S+)\s*$/m) || [])[1];
    var size = parseInt((text.match(/^\s*size:\s*(\d+)/m) || [])[1], 10);
    if (!version || !file) return null;
    return {
      version: version,
      file: file,
      hash: hash || '',
      size: isFinite(size) && size > 0 ? size : 0,
    };
  }

  function formatBytes(bytes) {
    if (!bytes || !isFinite(bytes)) return '—';
    var mb = bytes / (1024 * 1024);
    if (mb >= 1) return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /* ---------------------------------------------------------------------
     Applying the feed
     Every write is guarded, so a missing element on one page can never stop
     the rest of the page updating.
     --------------------------------------------------------------------- */

  function setText(selector, value) {
    if (value === null || value === undefined || value === '') return;
    $$('[data-version]').forEach(function (node) { node.textContent = value; });
    if (!selector) return;
    var target = $(selector);
    if (target) target.textContent = value;
  }

  /**
   * Reconciles the written release notes against what the feed actually has.
   *
   * The notes on this page describe one version. The feed may be serving a
   * different one, most often because a build has been prepared but not yet
   * uploaded. Printing both without comment would leave a visitor reading
   * "version 0.7.5" above a download that yields something else, so the
   * mismatch is called out plainly and the notes are labelled for the version
   * they actually describe.
   */
  function reconcile(publishedVersion) {
    var mismatch = publishedVersion && publishedVersion !== NOTES_VERSION;
    $$('[data-notes-version]').forEach(function (node) {
      node.textContent = NOTES_VERSION;
    });

    var notice = $('[data-mismatch]');
    if (!notice) return;
    if (!mismatch) { notice.hidden = true; return; }

    notice.hidden = false;
    var text = $('[data-mismatch-text]');
    if (text) {
      text.textContent = 'The published build is ' + publishedVersion +
        ', so the download button fetches that. The notes below describe ' + NOTES_VERSION +
        ', which is written up but not yet published. They are a preview of what is next, ' +
        'not a record of what you would receive today.';
    }
  }

  function applyRelease(info) {
    var downloadUrl = 'https://updates.yladevs.com/' + info.file;

    $$('[data-download]').forEach(function (link) {
      link.setAttribute('href', downloadUrl);
      link.setAttribute('download', info.file);
    });

    if (info.size) {
      $$('[data-size]').forEach(function (node) { node.textContent = formatBytes(info.size); });
    }

    if (info.hash) {
      $$('[data-hash]').forEach(function (node) { node.textContent = info.hash; });
    }

    $$('[data-status]').forEach(function (node) {
      node.classList.remove('is-offline');
      node.classList.add('is-current');
      node.textContent = 'Published · ' + info.version;
    });

    $$('[data-status-note]').forEach(function (node) {
      node.textContent = 'free, no account';
    });

    document.documentElement.setAttribute('data-release', info.version);
    reconcile(info.version);
  }

  function applyFallback(reason) {
    // The honest version of this: say the page could not confirm the feed,
    // rather than presenting the built-in numbers as if they were live.
    $$('[data-size]').forEach(function (node) { node.textContent = formatBytes(FALLBACK_BYTES); });
    $$('[data-status]').forEach(function (node) {
      node.classList.remove('is-current');
      node.classList.add('is-offline');
      node.textContent = 'Version ' + FALLBACK_VERSION + ' · feed not confirmed';
    });
    // With no feed to compare against, the notes are labelled for the version
    // they describe and no claim is made about what is published.
    reconcile(null);
    $$('[data-hash]').forEach(function (node) {
      if (node.textContent.indexOf('Loading') === 0) {
        node.textContent = 'Published hash could not be read. Open the download page with an internet connection, or read it from the update feed directly.';
      }
    });
    if (reason) console.info('Novaris site: using the built-in release details.', reason);
  }

  function loadRelease() {
    if (typeof fetch !== 'function') { applyFallback('fetch is unavailable'); return; }
    // A short timeout, because a download page that hangs on a network call is
    // worse than one that shows what it knows.
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;

    fetch(FEED, {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        if (!response.ok) throw new Error('feed returned ' + response.status);
        return response.text();
      })
      .then(function (text) {
        if (timer) clearTimeout(timer);
        var info = parseFeed(text);
        if (!info) { applyFallback('the feed did not contain a version'); return; }
        applyRelease(info);
      })
      .catch(function (error) {
        if (timer) clearTimeout(timer);
        // The expected case: the feed is served from a bucket that may not send
        // CORS headers, so the browser blocks the read. The page still works.
        applyFallback(error && error.message);
      });
  }

  /* ---------------------------------------------------------------------
     Chrome and Electron versions, stated from the page itself where possible
     --------------------------------------------------------------------- */

  function showEngineFacts() {
    // The user agent of a modern Chromium browser carries the brand list, which
    // is the only way to learn the engine version from the page. Everything
    // else stays as the server-rendered default.
    var ua = navigator.userAgent || '';
    var brand = (ua.match(/Chrom(?:e|ium)\/([\d.]+)/) || [])[1];
    if (!brand) return;
    $$('[data-chrome]').forEach(function (node) {
      node.textContent = brand.split('.').slice(0, 2).join('.');
    });
  }

  /* ---------------------------------------------------------------------
     Navigation
     --------------------------------------------------------------------- */

  function wireNav() {
    var toggle = $('.nav-toggle');
    var links = $('#nav-links');
    if (!toggle || !links) return;
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    links.addEventListener('click', function (event) {
      if (event.target.tagName !== 'A') return;
      links.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ---------------------------------------------------------------------
     Reveal on scroll
     --------------------------------------------------------------------- */

  function wireReveal() {
    var items = $$('.reveal');
    if (!items.length) return;
    var showAll = function () { items.forEach(function (item) { item.classList.add('is-visible'); }); };

    // The hidden state only exists once this class is on the root, so if the
    // script stops here the page is still fully readable.
    document.documentElement.classList.add('js');

    if (typeof IntersectionObserver !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      showAll();
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    items.forEach(function (item) { observer.observe(item); });

    // A safety net. Anything still hidden when the page is scrolled to the
    // bottom, or after a few seconds, is shown regardless, so a missed
    // intersection can never leave a section permanently blank.
    setTimeout(showAll, 4000);
    var revealRest = function () {
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 40) showAll();
    };
    window.addEventListener('scroll', revealRest, { passive: true });
  }

  /* ---------------------------------------------------------------------
     Copy to clipboard
     --------------------------------------------------------------------- */

  function toast(message) {
    var node = $('[data-toast]');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.classList.remove('is-visible'); }, 2200);
  }

  function copyText(value, message) {
    if (!value) { toast('Nothing to copy yet.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value)
        .then(function () { toast(message || 'Copied.'); })
        .catch(function () { toast('The browser would not allow that copy.'); });
      return;
    }
    toast('Copying is not available here. Select the text instead.');
  }

  function wireCopy() {
    var copyHash = $('[data-copy]');
    if (copyHash) {
      copyHash.addEventListener('click', function () {
        var hash = ($('[data-hash]') || {}).textContent || '';
        copyText(hash.trim(), 'Hash copied.');
      });
    }
    var copyCode = $('[data-copy-code]');
    if (copyCode) {
      copyCode.addEventListener('click', function () {
        copyText((copyCode.previousElementSibling || {}).textContent || '', 'Command copied.');
      });
    }
  }

  /* ---------------------------------------------------------------------
     Start
     --------------------------------------------------------------------- */

  function init() {
    wireNav();
    wireReveal();
    wireCopy();
    showEngineFacts();
    loadRelease();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
