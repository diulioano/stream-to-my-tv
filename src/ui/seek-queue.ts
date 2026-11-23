/** Skip sizes for the player's back/forward buttons and arrow keys (single source of truth). */
export const SKIP_BACK_SEC = 10;
export const SKIP_FORWARD_SEC = 10;

/**
 * Browser-side seek aggregator, emitted verbatim into the controller script.
 * Rapid nudges collapse into one `send(target)` after `delayMs` of quiet, so N taps cost one
 * stream request (one FFmpeg restart on remux) instead of N. Uses the global setTimeout/clearTimeout.
 */
export const SEEK_QUEUE_JS = String.raw`
function createSeekQueue(opts) {
  var target = null;
  var timer = null;
  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  return {
    nudge: function (deltaSec, currentSec, durationSec) {
      var base = target !== null ? target : Number(currentSec) || 0;
      var max = Number(durationSec) > 0 ? Number(durationSec) : 0;
      target = Math.max(0, Math.min(max, base + Number(deltaSec)));
      clear();
      timer = setTimeout(function () {
        var sec = target;
        timer = null;
        target = null;
        opts.send(sec);
      }, opts.delayMs);
      return target;
    },
    pending: function () { return target; },
    cancel: function () { clear(); target = null; }
  };
}
`;
