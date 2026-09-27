/* ==========================================================================
   Consent and advertising.

   Two rules govern this file.

   1. Google AdSense is not loaded until a visitor has actively accepted. Not
      on scroll, not on a timer, not by default. The script tag is only added to
      the document after consent, so a refusal means the request is never made
      and no Google identifier is ever set on that visitor's machine.

   2. The consent record is stored in localStorage, not a cookie. That is a
      deliberate choice: it keeps the banner's own bookkeeping out of the cookie
      jar, so the site can truthfully say it sets no cookies of its own, and the
      only cookies present belong to the advertising partner.
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'novaris.consent.v1';
  var config = (window.NOVARIS_SITE || {});
  var ads = config.ads || {};

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function toast(message) {
    var node = $('[data-toast]');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.classList.remove('is-visible'); }, 2400);
  }

  /* ---------------------------------------------------------------------
     The consent record
     --------------------------------------------------------------------- */

  function readConsent() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.status !== 'string') return null;
      return parsed;
    } catch (error) {
      // A blocked or full storage must not break the site. The banner simply
      // comes back on the next visit, which is the safe direction to fail.
      return null;
    }
  }

  function writeConsent(status) {
    var record = {
      status: status,                 // 'accepted' or 'refused'
      at: new Date().toISOString(),
      // Recorded so the choice can be evidenced later, which is what a consent
      // framework is for.
      version: 1,
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch (error) { /* not fatal */ }
    return record;
  }

  function hasConsented() {
    var record = readConsent();
    return Boolean(record && record.status === 'accepted');
  }

  /* ---------------------------------------------------------------------
     AdSense loading
     --------------------------------------------------------------------- */

  var adsLoaded = false;

  function publisherConfigured() {
    return Boolean(ads.publisher) && ads.publisher.indexOf('REPLACE') === -1;
  }

  function loadAdSense() {
    if (adsLoaded) return;
    if (!ads.enabled || !publisherConfigured()) return;
    adsLoaded = true;

    var script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    // The client library decides which slots to fill, and only once it is here.
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ads.publisher);
    document.head.appendChild(script);

    // Ask the library to fill anything inside an adsbygoogle element.
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (error) { /* non-fatal */ }
  }

  /**
   * Shows a placeholder for any slot that has not been filled, so the page never
   * has a hole where an ad should be and never claims to have one when the
   * publisher id is still a placeholder.
   */
  function decorateSlots() {
    var slots = ads.slots || {};
    $$('.ad-slot').forEach(function (slot) {
      var name = slot.getAttribute('data-ad-slot');
      var frame = $('[data-ad-frame]', slot);
      if (!frame) return;

      var configured = !!(ads.enabled && publisherConfigured() && slots[name] && slots[name].indexOf('REPLACE') === -1);
      if (!configured || !hasConsented()) {
        // Say plainly that this is a placeholder rather than leaving a blank
        // rectangle a visitor might read as a broken page.
        frame.textContent = ads.enabled
          ? 'Advertisement'
          : 'Advertising is switched off on this site.';
        slot.classList.remove('is-filled');
        return;
      }

      var ad = document.createElement('ins');
      ad.className = 'adsbygoogle';
      ad.style.display = 'block';
      ad.style.width = '100%';
      ad.setAttribute('data-ad-client', ads.publisher);
      ad.setAttribute('data-ad-slot', slots[name]);
      ad.setAttribute('data-ad-format', 'auto');
      ad.setAttribute('data-full-width-responsive', 'true');
      frame.appendChild(ad);
      slot.classList.add('is-filled');
    });

    if (hasConsented() && publisherConfigured()) {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (error) { /* non-fatal */ }
    }
  }

  /* ---------------------------------------------------------------------
     Banner
     --------------------------------------------------------------------- */

  function renderBanner() {
    var banner = $('[data-consent]');
    if (!banner) return;

    var record = readConsent();
    if (record) {
      // Already answered. Keep the link to change the answer visible in the
      // footer, which is the part most sites get wrong.
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
  }

  function decide(status) {
    writeConsent(status);
    var banner = $('[data-consent]');
    if (banner) banner.hidden = true;

    if (status === 'accepted') {
      loadAdSense();
      toast('Advertising allowed. Change this at any time from the footer.');
    } else {
      // Removing the script matters as much as not adding it: a refusal after
      // an accidental accept should actually stop the requests.
      $$('script[src*="googlesyndication"]').forEach(function (node) { node.remove(); });
      adsLoaded = false;
      $$('.ad-slot.is-filled').forEach(function (slot) {
        slot.classList.remove('is-filled');
        var frame = $('[data-ad-frame]', slot);
        if (frame) frame.textContent = 'Advertising declined. Nothing is loaded and no cookies are set by ads.';
      });
      toast('Advertising declined. Nothing was loaded.');
    }
    decorateSlots();
  }

  function wireBanner() {
    var banner = $('[data-consent]');
    if (banner) {
      var accept = $('[data-consent-accept]', banner);
      var reject = $('[data-consent-reject]', banner);
      var manage = $('[data-consent-manage]', banner);
      if (accept) accept.addEventListener('click', function () { decide('accepted'); });
      if (reject) reject.addEventListener('click', function () { decide('refused'); });
      if (manage) manage.addEventListener('click', function () { banner.hidden = false; });
    }

    // The persistent way to change your mind, which the law requires to be as
    // easy as saying yes the first time.
    $$('[data-consent-reset]').forEach(function (button) {
      button.addEventListener('click', function () {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* non-fatal */ }
        var bannerNode = $('[data-consent]');
        if (bannerNode) bannerNode.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ---------------------------------------------------------------------
     Donations
     --------------------------------------------------------------------- */

  function wireDonations() {
    var donate = config.donate || {};
    var paypal = donate.paypal || {};
    var cashapp = donate.cashapp || {};

    var paypalLink = $('[data-donate-paypal]');
    if (paypalLink) {
      var paypalReady = paypal.enabled && paypal.me && paypal.me.indexOf('REPLACE') === -1;
      if (paypalReady) {
        paypalLink.href = 'https://paypal.me/' + encodeURIComponent(paypal.me);
        paypalLink.removeAttribute('aria-disabled');
        paypalLink.classList.remove('is-disabled');
      } else {
        // Visibly inert, and saying why, rather than a link that silently fails.
        paypalLink.setAttribute('aria-disabled', 'true');
        paypalLink.classList.add('is-disabled');
        paypalLink.removeAttribute('href');
        paypalLink.title = 'Add your PayPal name in js/config.js to enable this button.';
      }
    }

    var cashLink = $('[data-donate-cashapp]');
    if (cashLink) {
      var cashReady = cashapp.enabled && cashapp.cashtag && cashapp.cashtag.indexOf('REPLACE') === -1;
      if (cashReady) {
        cashLink.href = 'https://cash.app/$' + encodeURIComponent(cashapp.cashtag.replace(/^\$/, ''));
        cashLink.removeAttribute('aria-disabled');
        cashLink.classList.remove('is-disabled');
      } else {
        cashLink.setAttribute('aria-disabled', 'true');
        cashLink.classList.add('is-disabled');
        cashLink.removeAttribute('href');
        cashLink.title = 'Add your CashApp cashtag in js/config.js to enable this button.';
      }
    }
  }

  /* ---------------------------------------------------------------------
     Start
     --------------------------------------------------------------------- */

  function init() {
    wireBanner();
    wireDonations();
    renderBanner();

    // Order matters: consent is read before any ad markup is touched.
    if (hasConsented()) loadAdSense();
    decorateSlots();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
