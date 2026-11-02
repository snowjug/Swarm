/**
 * The light behind the product. Three soft orbs and a fine grain, fixed behind everything; the colour of
 * the orbs follows the scene (see `[data-scene]` in tokens.css) and crossfades when the scene changes.
 * It is decoration and carries no data; with high contrast or reduced transparency it is flat.
 */
export function Aurora() {
  return (
    <div className="sw-aurora" aria-hidden="true">
      <div className="sw-aurora__orb sw-aurora__orb--a" />
      <div className="sw-aurora__orb sw-aurora__orb--b" />
      <div className="sw-aurora__orb sw-aurora__orb--c" />
      <div className="sw-aurora__vignette" />
      <div className="sw-aurora__grain" />
    </div>
  );
}
