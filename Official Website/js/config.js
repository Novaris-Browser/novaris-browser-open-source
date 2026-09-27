/* ==========================================================================
   Novaris Browser — site configuration

   One file holding every value that differs between a developer's machine and
   the live site: the domain, the AdSense publisher id, the payment
   placeholders, and the feed. Nothing here is a secret, but keeping it in one
   place means going live is an edit rather than a search.
   ========================================================================== */

window.NOVARIS_SITE = {

  /* The canonical origin. Used for canonical tags, the sitemap and structured
     data. Must be the real https origin in production, with no trailing slash. */
  origin: 'https://novarisbrowser.example',

  /* Where published installers and the update manifest live. */
  feed: 'https://updates.yladevs.com/latest.yml',

  /* ------------------------------------------------------------------------
     Google AdSense

     Replace PUBLISHER with the ca-pub- id from your AdSense account. The loader
     does nothing at all until a visitor has accepted, so the script is never
     even requested before consent.
     ------------------------------------------------------------------------ */
  ads: {
    enabled: true,
    publisher: 'ca-pub-REPLACE_WITH_YOUR_PUBLISHER_ID',
    /* Slot ids, one per placement below. Filled from the AdSense dashboard. */
    slots: {
      homeMid: 'REPLACE_SLOT_HOME_MID',
      homeFoot: 'REPLACE_SLOT_HOME_FOOT',
      downloadFoot: 'REPLACE_SLOT_DOWNLOAD_FOOT',
      article: 'REPLACE_SLOT_ARTICLE',
    },
  },

  /* ------------------------------------------------------------------------
     Donations

     Placeholders on purpose. A donate button pointing at an invented account
     takes money from nobody and misleads everyone, so these are left visibly
     marked until real values are supplied.
     ------------------------------------------------------------------------ */
  donate: {
    paypal: {
      // Either a PayPal.me name, or a hosted-button id from paypal.com.
      me: 'REPLACE_WITH_YOUR_PAYPAL_ME_NAME',
      hostedButtonId: 'REPLACE_WITH_YOUR_PAYPAL_BUTTON_ID',
      enabled: false,
    },
    cashapp: {
      cashtag: 'REPLACE_WITH_YOUR_CASHAPP_CASHTAG',
      enabled: false,
    },
  },

  /* Effective date shown on the legal pages. */
  legalUpdated: '27 September 2026',
};
