// Media session and picture-in-picture helpers.
//
// Chromium implements the Media Session API inside a page, but the browser's own
// media controls live in our shell, outside that page. So the page publishes what
// it is playing and the shell sends commands back. Both directions are plain
// function bodies returned as source strings, because they have to be evaluated
// inside the page's own world rather than in the preload's isolated one.

// Runs in the page. Publishes the current media metadata and artwork to the
// shell, and listens for commands coming back the other way.
//
// Guarded so a hostile page cannot learn anything from the channel beyond what
// the user chose to play: the payload is metadata only, and it is posted on
// demand rather than continuously.
function mediaPublisherSource() {
  return `(() => {
    if (window.__novarisMediaInstalled) return 'already';
    window.__novarisMediaInstalled = true;
    const pick = () => {
      const media = [...document.querySelectorAll('video, audio')].find((el) => !el.paused && !el.ended && el.readyState > 0)
        || [...document.querySelectorAll('video, audio')].sort((a, b) => b.videoWidth - a.videoWidth)[0];
      return media || null;
    };
    window.__novarisMedia = () => {
      const media = pick();
      if (!media) return null;
      const meta = navigator.mediaSession && navigator.mediaSession.metadata;
      return {
        title: (meta && meta.title) || media.getAttribute('title') || document.title || '',
        artist: (meta && meta.artist) || '',
        album: (meta && meta.album) || '',
        artwork: meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : '',
        playing: !media.paused && !media.ended,
        duration: Number.isFinite(media.duration) ? media.duration : 0,
        position: media.currentTime || 0,
        volume: media.volume,
        muted: media.muted,
        source: media.currentSrc ? new URL(media.currentSrc, location.href).host : location.host,
      };
    };
    window.__novarisMediaCommand = (action, value) => {
      const media = pick();
      if (!media) return false;
      switch (action) {
        case 'play': media.play(); return true;
        case 'pause': media.pause(); return true;
        case 'toggle': media.paused ? media.play() : media.pause(); return true;
        case 'seek': if (Number.isFinite(value)) { media.currentTime = Math.max(0, value); return true; } return false;
        case 'forward': media.currentTime = Math.min(Number.isFinite(media.duration) ? media.duration : Infinity, media.currentTime + (Number(value) || 10)); return true;
        case 'back': media.currentTime = Math.max(0, media.currentTime - (Number(value) || 10)); return true;
        case 'mute': media.muted = !media.muted; return true;
        case 'volume': if (Number.isFinite(value)) { media.volume = Math.max(0, Math.min(1, value)); return true; } return false;
        case 'pip': return requestPictureInPicture(media);
        default: return false;
      }
    };
    // Chromium raises this when a page's own controls change the state, so the
    // shell can follow along instead of showing a stale play button.
    ['play', 'pause', 'ended', 'volumechange', 'timeupdate'].forEach((name) => {
      document.addEventListener(name, () => {
        if (window.__novarisMediaDirty) window.__novarisMediaDirty();
      }, true);
    });
    return 'installed';
  })()`;
}

const MEDIA_ACTIONS = Object.freeze(['play', 'pause', 'toggle', 'seek', 'forward', 'back', 'mute', 'volume', 'pip']);

// What the shell is allowed to send. Anything not in this list is refused, so a
// page cannot turn the media bridge into a general script runner.
function isAllowedMediaAction(action) {
  return MEDIA_ACTIONS.includes(action);
}

/** A seek is only accepted inside the media's own duration. */
function clampSeek(value, duration) {
  const position = Number(value);
  if (!Number.isFinite(position) || position < 0) return null;
  if (Number.isFinite(duration) && duration > 0 && position > duration) return duration;
  return position;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Whether a control should be shown, given what the page reported. */
function mediaControlState(info) {
  if (!info) return { available: false, showPosition: false, showVolume: false };
  return {
    available: true,
    showPosition: Number(info.duration) > 0,
    showVolume: typeof info.volume === 'number',
    // A page with no title still gets a control, labelled by its host, so the
    // user can tell what they are about to pause.
    label: info.title || info.source || 'Media',
  };
}

module.exports = {
  MEDIA_ACTIONS,
  clampSeek,
  formatTime,
  isAllowedMediaAction,
  mediaControlState,
  mediaPublisherSource,
};
