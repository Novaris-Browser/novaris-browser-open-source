import { useEffect, useRef, useState } from 'react';
import { Pause, PictureInPicture2, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { formatTime } from '../../electron/media-controls';

/**
 * Media controls for the active page.
 *
 * The page is the source of truth: it publishes what it is playing and this bar
 * sends commands back. That means a page that changes its own state, for example
 * a playlist advancing on its own, is followed rather than fought.
 */
export default function MediaBar({ active, tabId, onSendCommand, onClose }) {
  const [info, setInfo] = useState(null);
  const pollTimer = useRef(null);

  useEffect(() => {
    if (!active) {
      setInfo(null);
      return undefined;
    }
    // Polled rather than event driven, because the page is a separate world and
    // a poll is the honest way to ask without trusting it to report truthfully.
    pollTimer.current = window.setInterval(() => {
      if (!onSendCommand) return;
      onSendCommand(tabId, '__read').then((value) => {
        setInfo(value || null);
      }).catch(() => setInfo(null));
    }, 1000);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [active, tabId, onSendCommand]);

  if (!active || !info) return null;

  const send = (action, value) => {
    if (onSendCommand) onSendCommand(tabId, action, value);
  };

  const position = Number(info.position) || 0;
  const duration = Number(info.duration) || 0;
  const hasDuration = duration > 0;

  return (
    <div className="media-bar" role="group" aria-label="Media controls">
      <div className="media-bar-now">
        {info.artwork ? <img src={info.artwork} alt="" className="media-bar-art" /> : null}
        <div className="media-bar-text">
          <strong>{info.title || info.source || 'Media'}</strong>
          {info.artist ? <span>{info.artist}</span> : null}
        </div>
      </div>

      <div className="media-bar-controls">
        <button type="button" onClick={() => send('back', 10)} aria-label="Back 10 seconds" title="Back 10 seconds"><SkipBack size={14} /></button>
        <button className="media-bar-play" type="button" onClick={() => send('toggle')} aria-label={info.playing ? 'Pause' : 'Play'} title={info.playing ? 'Pause' : 'Play'}>
          {info.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" onClick={() => send('forward', 10)} aria-label="Forward 10 seconds" title="Forward 10 seconds"><SkipForward size={14} />
        </button>
      </div>

      {hasDuration ? (
        <div className="media-bar-progress">
          <span>{formatTime(position)}</span>
          <input
            type="range"
            min="0"
            max={Math.floor(duration)}
            value={Math.min(Math.floor(position), Math.floor(duration))}
            onChange={(event) => send('seek', Number(event.target.value))}
            aria-label="Seek"
          />
          <span>{formatTime(duration)}</span>
        </div>
      ) : null}

      <div className="media-bar-right">
        <button type="button" onClick={() => send('mute')} aria-label={info.muted ? 'Unmute' : 'Mute'} title={info.muted ? 'Unmute' : 'Mute'}>
          {info.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        {hasDuration ? (
          <button type="button" onClick={() => send('pip')} aria-label="Picture in picture" title="Picture in picture">
            <PictureInPicture2 size={14} />
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Hide media controls" title="Hide">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
