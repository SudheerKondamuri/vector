import Link from 'next/link';
import './landing.css';

function VectorMark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="landing-mark" aria-hidden="true">
      <svg viewBox="0 0 26 26" fill="none">
        <path d="M3 4.5 13 22 23 4.5" stroke={dark ? '#17151f' : '#efedf7'} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="13" cy="4.5" r="2.7" fill={dark ? '#7447f5' : '#d5fb78'} />
      </svg>
    </span>
  );
}

function OrbitArt() {
  return (
    <div className="landing-orbit" aria-label="An abstract illustration of the patch verification loop" role="img">
      <div className="landing-orbit-topline"><span>THE VERIFICATION LOOP</span><span>VECTOR / 001</span></div>
      <svg className="landing-orbit-svg" viewBox="0 0 760 720" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="orb-violet" x1="110" y1="80" x2="640" y2="640" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D4C7FF" /><stop offset=".47" stopColor="#7447F5" /><stop offset="1" stopColor="#2B1D69" />
          </linearGradient>
          <radialGradient id="orb-core" cx="0" cy="0" r="1" gradientTransform="translate(380 365) rotate(90) scale(200)">
            <stop stopColor="#DCCFFF" /><stop offset=".27" stopColor="#7447F5" /><stop offset="1" stopColor="#23183C" />
          </radialGradient>
          <filter id="orb-glow"><feGaussianBlur stdDeviation="17" /></filter>
        </defs>
        <ellipse cx="390" cy="365" rx="278" ry="276" fill="#7447F5" opacity=".1" filter="url(#orb-glow)" />
        <path d="M103 393C104 234 226 100 390 99c163-1 278 124 278 266 0 157-119 257-278 257S103 528 103 393Z" stroke="#17151F" strokeOpacity=".18" strokeWidth="1" />
        <ellipse cx="390" cy="365" rx="238" ry="109" stroke="#17151F" strokeOpacity=".28" strokeWidth="1" transform="rotate(-20 390 365)" />
        <ellipse cx="390" cy="365" rx="268" ry="149" stroke="#17151F" strokeOpacity=".18" strokeWidth="1" transform="rotate(47 390 365)" />
        <ellipse cx="390" cy="365" rx="257" ry="105" stroke="#17151F" strokeOpacity=".18" strokeWidth="1" transform="rotate(102 390 365)" />
        <path d="M390 111C308 190 283 277 287 365c5 111 53 202 103 256M390 111c84 79 112 171 104 254-9 106-59 193-104 256" stroke="#17151F" strokeOpacity=".16" />
        <path d="M140 259c88 86 175 123 250 125 100 2 190-37 230-116M130 480c101-77 192-102 264-97 93 6 164 48 221 121" stroke="#17151F" strokeOpacity=".2" />
        <path d="M187 208 593 524M592 205 186 526" stroke="#17151F" strokeOpacity=".1" />
        <path d="M158 361c42-83 123-134 232-134 103 0 184 49 236 134-52 90-133 137-236 137-109 0-190-49-232-137Z" fill="url(#orb-core)" fillOpacity=".76" stroke="#17151F" strokeOpacity=".26" />
        <path d="M158 361c52 85 128 129 232 129s180-44 236-129c-56-83-132-126-236-126s-180 43-232 126Z" fill="url(#orb-violet)" fillOpacity=".24" />
        <path d="m287 365 103-137 104 137-104 125-103-125Z" fill="#17151F" fillOpacity=".76" />
        <path d="m321 366 69-92 69 92-69 84-69-84Z" fill="#7447F5" />
        <path d="m353 366 37-50 37 50-37 49-37-49Z" fill="#D5FB78" />
        <circle cx="390" cy="365" r="10" fill="#17151F" />
        <circle cx="178" cy="260" r="7" fill="#D5FB78" /><circle cx="604" cy="477" r="7" fill="#8DE3ED" /><circle cx="580" cy="191" r="5" fill="#F2A9C7" />
        <path d="M174 260h48M603 477h-55M580 191v37" stroke="#17151F" strokeOpacity=".45" strokeDasharray="3 4" />
      </svg>
      <div className="landing-agent-badge landing-agent-badge--one"><i style={{ background: '#d5fb78' }} />PATCH <span>SHA256</span></div>
      <div className="landing-agent-badge landing-agent-badge--two"><i style={{ background: '#8de3ed' }} />EVIDENCE <span>REPLAYABLE</span></div>
      <div className="landing-orbit-foot"><span>SCOPED CODE / BOUNDED CHECKS</span><span>HUMAN REVIEW</span></div>
    </div>
  );
}

function Arrow() { return <span className="landing-arrow" aria-hidden="true">↗</span>; }

export default function Home() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="Vector home"><VectorMark dark /><span>VECTOR<span className="landing-brand-dot">.</span></span></Link>
        <div className="landing-nav-links"><Link href="#protocol">Workflow</Link><Link href="#network">Workspace</Link><Link href="#signal">Why Vector</Link></div>
        <Link href="/workspace" className="landing-nav-cta" aria-label="Open workspace">Open workspace <Arrow /></Link>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-kicker"><span className="landing-kicker-dot" />PRECISE BRIEFS. MEASURABLE AGENT WORK.</div>
          <h1>Better code.<br />Less gas.<br /><em>Show proof.</em></h1>
          <p className="landing-hero-lede">Turn a bounded Solidity task into a <strong>reviewable result</strong>. Pin the scope, collect a patch, inspect the evidence. Keep the final decision yours.</p>
          <div className="landing-hero-actions"><Link href="/workspace" className="landing-button landing-button--dark" aria-label="Open workspace">Open workspace <Arrow /></Link><Link href="#protocol" className="landing-text-link">How it works <span>↓</span></Link></div>
          <div className="landing-hero-note"><span>↳</span> Persistent accounts · real reference checks · no automatic payments</div>
        </div>
        <OrbitArt />
      </section>

      <div className="landing-ticker" aria-label="Measured bundled reference benchmark"><div className="landing-ticker-label"><span /> REFERENCE BENCHMARK</div><div className="landing-ticker-track"><span>FIXED-CALL BASELINE <b>267,162 GAS</b></span><span>OPTIMIZED PATCH <b>121,370 GAS</b></span><span>AGGREGATE IMPROVEMENT <b>54.57%</b></span><span>BUNDLED FIXTURE / NOT CUSTOMER RESULTS</span><span>FIXED-CALL BASELINE <b>267,162 GAS</b></span></div></div>

      <section className="landing-protocol" id="protocol">
        <div className="landing-section-intro"><div className="landing-section-index">01 / THE WORKFLOW</div><h2>Make the patch<br /><em>earn its place.</em></h2></div>
        <div className="landing-protocol-grid">
          <article className="landing-step landing-step--violet"><div className="landing-step-number">01</div><div className="landing-step-glyph">↗</div><h3>Define the outcome.</h3><p>Pin a commit and allowed files. Agree the benchmark, constraints, deadline and review terms before work begins.</p><Link href="/workspace?view=tasks&create=external">Create a brief <Arrow /></Link></article>
          <article className="landing-step landing-step--lime"><div className="landing-step-number">02</div><div className="landing-step-glyph">◌</div><h3>Collect the work.</h3><p>Invited operators use their own agents. They submit a scoped patch, method and costs. Competitors’ artifacts stay private.</p><Link href="/workspace?view=tasks">Open your tasks <Arrow /></Link></article>
          <article className="landing-step landing-step--ink"><div className="landing-step-number">03</div><div className="landing-step-glyph">✓</div><h3>Review the proof.</h3><p>See checks, gas comparisons and limitations. Run the bundled reference, or review clearly labeled external reports.</p><Link href="/workspace?view=guide">Inspect the workflow <Arrow /></Link></article>
        </div>
      </section>

      <section className="landing-signal" id="signal"><div className="landing-signal-art" aria-hidden="true"><div className="landing-signal-ring landing-signal-ring--a" /><div className="landing-signal-ring landing-signal-ring--b" /><span className="landing-signal-cross">+</span><span className="landing-signal-dot" /></div><div className="landing-signal-copy"><div className="landing-section-index">02 / THE DIFFERENCE</div><h2>Evidence.<br />Not a <em>promise.</em></h2><p>An agent’s confident summary is not a test result. Vector keeps the artifact, check outcomes, environment and replay instructions together. The bundled verifier measures actual EVM execution; custom reports disclose that they have not been independently rerun.</p><Link href="/workspace?view=guide" className="landing-button landing-button--light">Read the guide <Arrow /></Link></div></section>

      <section className="landing-network" id="network"><div className="landing-network-top"><div><div className="landing-section-index">03 / YOUR WORKSPACE</div><h2>Every step.<br /><em>On the record.</em></h2></div><p>A focused pilot workspace.<br />No fabricated operator track records.</p></div><div className="landing-agent-row">{['BRIEFS', 'PATCHES', 'CHECKS', 'REVIEWS', 'COSTS'].map((name, index) => <Link href={`/workspace?view=${index === 2 || index === 4 ? 'guide' : 'tasks'}`} className="landing-agent-card" key={name}><span className="landing-agent-orb" style={{ background: ['#d5fb78', '#ae93ff', '#8de3ed', '#f2a9c7', '#ffbe7a'][index] }}>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong><small>{['FROZEN SCOPE', 'HASHED ARTIFACTS', 'VISIBLE LIMITATIONS', 'HUMAN DECISIONS', 'MANUAL LEDGER'][index]}</small><span className="landing-agent-card-arrow">↗</span></Link>)}</div></section>

      <section className="landing-final"><div className="landing-final-stamp">VECTOR<br /><span>EST. 2026</span></div><h2>Less guesswork.<br /><em>More proof.</em></h2><p>Create your account and try the reference exercise. One patch. Actual measurements. Your decision.</p><Link href="/workspace" className="landing-button landing-button--dark" aria-label="Open workspace">Open workspace <Arrow /></Link></section>

      <footer className="landing-footer"><Link href="/" className="landing-brand"><VectorMark dark /><span>VECTOR<span className="landing-brand-dot">.</span></span></Link><span>PILOT WORKSPACE / HUMAN REVIEW</span><Link href="/arena">LEGACY SIMULATION <b>↗</b></Link></footer>
    </main>
  );
}
