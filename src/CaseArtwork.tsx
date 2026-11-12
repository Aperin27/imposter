import { memo } from 'react';

export function Arrow({ direction = 'right' }: { direction?: 'right' | 'up' }) {
  return <svg className="arrow-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={direction === 'up' ? 'M5 19 19 5M5 5h14v14' : 'M4 12h16m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.7" /></svg>;
}
export function Fingerprint({ className = '' }: { className?: string }) {
  return <svg className={`fingerprint ${className}`} viewBox="0 0 80 90" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 46V36a28 28 0 0 1 56 0v14M5 34a35 35 0 0 1 70 2v7M11 58c0 9-2 15-5 20M69 60c0 11-3 20-7 26" />
      <path d="M20 52V36a20 20 0 0 1 40 0v20c0 11-2 21-6 29M18 65c-1 8-3 14-6 19M27 76c3-10 2-19 2-26V36a11 11 0 0 1 22 0v20c0 11-2 20-6 29M37 84c5-10 6-21 6-30V37M36 36v24c0 5-1 10-2 13" />
    </g>
  </svg>;
}

// Original decorative dossier. No real player, role or question data is used.
export const CaseArtwork = memo(function CaseArtwork() {
  return <div className="case-artwork" aria-hidden="true">
    <div className="art-registration"><span>PROPERTY OF THE GROUP</span><span>REF. 00—?</span></div>
    <div className="art-folder" />
    <div className="art-sheet paper">
      <div className="art-sheet-head"><span>PERSON OF INTEREST</span><span>NO. 001</span></div>
      <div className="suspect-photo">
        <svg viewBox="0 0 300 270" fill="none">
          <path d="M0 48h300M0 98h300M0 148h300M0 198h300M0 248h300" stroke="#111216" strokeOpacity=".15" />
          <path d="M23 0v270M277 0v270" stroke="#111216" strokeOpacity=".15" />
          <path d="m45 270 13-53c5-19 34-28 58-37l8-29h52l8 29c24 9 53 18 58 37l13 53" fill="#24262d" />
          <path d="m115 182 35 25 35-25-10 88h-50z" fill="#44464c" />
          <path d="m150 210-10 17 7 43h9l6-43z" fill="#17181c" />
          <path d="M104 84c0-37 19-55 46-55s46 18 46 55l-5 42c-4 28-23 44-41 44s-37-16-41-44z" fill="#24262d" />
          <path d="M102 83c-4-24 3-43 16-54 16-14 44-13 61 0 17 14 20 31 18 54l-17-23c-17 12-41 10-57 1z" fill="#17181c" />
          <path d="m143 93-5 29 13 2M133 142h34" stroke="#44464c" strokeWidth="3" />
          <path d="M26 24h16m-8-8v16m224 210h16m-8-8v16" stroke="#8b332e" strokeWidth="1.5" />
          <rect x="79" y="85" width="142" height="26" fill="#111216" transform="rotate(-3 79 85)" />
          <text x="150" y="104" textAnchor="middle" fill="#F0EBDF" fontFamily="monospace" fontSize="10" letterSpacing="5">REDACTED</text>
        </svg>
        <span className="photo-caption">IDENTITY UNCONFIRMED</span>
      </div>
      <div className="art-notes"><span>KNOWN ASSOCIATES</span><i /><i className="short" /></div>
      <div className="art-bottom"><Fingerprint /><span>Trust no one.<br />Especially your friends.</span></div>
      <span className="art-stamp">UNDER<br />SUSPICION</span>
    </div>
    <span className="art-clip" />
    <div className="art-evidence-tag"><span>EXHIBIT A</span><b>Everyone has<br />a story.</b></div>
    <div className="art-caption"><span className="crosshair">+</span> ONE OF THEM DOESN’T MATCH.</div>
  </div>;
});
