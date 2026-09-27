const ADBLOCK_MANIFEST = Object.freeze({
  manifest_version: 3,
  name: 'Novaris Ad Blocker',
  version: '1.0.0',
  description: 'First-party ad blocking for Novaris.',
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content.js'],
      run_at: 'document_start',
      all_frames: true,
    },
  ],
});

// Selectors are combined into a stylesheet and also removed from the DOM.
// Keep both lists free of syntax that a browser would reject.
const COSMETIC_SELECTORS = Object.freeze([
  // Google Ad Manager / AdSense slots
  'ins.adsbygoogle',
  '.adsbygoogle',
  '.ads-ad',
  '[id^="google_ads"]',
  '[id*="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[id*="div-gpt-ad"]',
  '.google-ad',
  '.google-ad-vert',
  '.google-ad-horiz',
  'iframe[id^="google_ads_iframe"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="googleadservices.com"]',
  'iframe[src*="google.com/ads"]',
  'iframe[name*="google_ads"]',
  // Generic ad containers and slots
  '[data-ad-client]',
  '[data-ad-slot]',
  '[data-adunit]',
  '[data-ad-unit]',
  '[data-ad-zone]',
  '[data-ad-id]',
  '[data-ad]',
  '[data-advertisement]',
  '[data-component-type="SponsoredAd"]',
  '[aria-label="Advertisement"]',
  '[aria-label="Advertiser"]',
  '[aria-label="Ad"]',
  '.ad',
  '.ads',
  '.ads-ad',
  '.ad-unit',
  '.ad-unit',
  '.ad-slot',
  '.ad-slot',
  '.ad-placement',
  '.ad-placement',
  '.ad-container',
  '.ad-container',
  '.ad-wrapper',
  '.ad-wrapper',
  '.ad-banner',
  '.ad-banner',
  '.ad-block',
  '.ad-label',
  '.ad-title',
  '.ad-text',
  '.advert',
  '.advertisement',
  '.advertising',
  '.adverts',
  '.dfp-ad',
  '.mpu-ad',
  '.leaderboard-ad',
  '.billboard-ad',
  '.rectangle-ad',
  '.large-leaderboard-ad',
  '.medium-rectangle-ad',
  '.side-ad',
  '.sidebar-ad',
  '.in-article-ad',
  '.native-ad',
  '.sponsored-ad',
  '.sponsored-content',
  '.sponsored-link',
  '.sponsored-result',
  '.promoted-content',
  '.promoted-link',
  '.promoted-result',
  '#ad-container',
  '#ad-slot',
  '#ad-unit',
  '#ad-wrapper',
  '#adbanner',
  '#ad-banner',
  '#advertisement',
  '#advert',
  '#banner-ad',
  '#sponsored',
  '#taboola',
  '#outbrain_widget',
  // Sticky / interstitial overlays
  '.ai-sticky-ad',
  '.adthrive',
  '.adthrive-slot',
  '.sticky-ad',
  '.sticky-bottom-ad',
  '.overlay-ad',
  '.interstitial-ad',
  '.popunder',
  '.pop-up-ad',
  // Recommendation widgets
  '.taboola',
  '.taboola-container',
  '.trc_related_container',
  '.outbrain',
  '.OUTBRAIN',
  '[id^="taboola"]',
  '[id^="outbrain"]',
  '[class^="taboola"]',
  '[class^="outbrain"]',
  '[id^="trc_related"]',
  // News and feed sponsored rows
  '[data-testid="sponsored-ad"]',
  '[data-testid="promoted-stories"]',
  '.promoted-story',
  '.promoted-post',
  '.sponsor-story',
  // Cookie and consent walls that only exist for ad partners
  '#googlefc-anchor',
  '#googlefc-iframe',
]);

function buildAdblockContent({ cosmetic = { block: [], allow: [] } } = {}) {
  const custom = Array.isArray(cosmetic.block) ? cosmetic.block.filter((item) => typeof item === 'string') : [];
  const exceptions = Array.isArray(cosmetic.allow) ? cosmetic.allow.filter((item) => typeof item === 'string') : [];
  return `(() => {
  const baseSelectors = ${JSON.stringify(COSMETIC_SELECTORS)};
  const customSelectors = ${JSON.stringify(custom)};
  const exceptions = ${JSON.stringify(exceptions)};
  const selectors = [...baseSelectors, ...customSelectors];
  const isVisible = (element) => {
    try { return element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0; } catch { return false; }
  };
  const buildStyle = () => {
    if (!selectors.length) return null;
    // Join with a comma plus a space: a comma with no separator can mis-parse.
    const style = document.createElement('style');
    style.setAttribute('data-novaris-adblock', 'style');
    style.textContent = selectors.join(', ') + '{display:none!important;visibility:hidden!important;opacity:0!important;min-height:0!important;max-height:0!important;position:absolute!important;pointer-events:none!important;}';
    return style;
  };
  const isException = (element) => {
    for (const selector of exceptions) {
      try { if (element.matches(selector) || element.querySelector(selector)) return true; } catch { /* Invalid selector. */ }
    }
    return false;
  };
  const clean = () => {
    for (const selector of selectors) {
      let nodes = [];
      try { nodes = document.querySelectorAll(selector); } catch { continue; }
      for (const element of nodes) {
        if (!element || element.hasAttribute('data-novaris-adblock')) continue;
        if (isException(element)) continue;
        element.setAttribute('data-novaris-adblock', 'hidden');
        // Keep the subtree so a later reload can restore layout, but detach it.
        element.remove();
      }
    }
  };
  const start = () => {
    if (!document.documentElement) return requestAnimationFrame(start);
    const style = buildStyle();
    if (style && !document.querySelector('style[data-novaris-adblock]')) document.documentElement.appendChild(style);
    clean();
    const observer = new MutationObserver(() => clean());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', clean, { once: true });
    window.addEventListener('load', clean, { once: true });
  };
  start();
})();`;
}

function buildAdblockFiles(cosmetic) {
  return {
    'manifest.json': `${JSON.stringify(ADBLOCK_MANIFEST, null, 2)}\n`,
    'content.js': buildAdblockContent({ cosmetic }),
  };
}

const ADBLOCK_FILES = buildAdblockFiles();

module.exports = { ADBLOCK_FILES, ADBLOCK_MANIFEST, COSMETIC_SELECTORS, buildAdblockFiles, buildAdblockContent };
