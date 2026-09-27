import React from 'react';

export function Hero() { return <>
 <section className="container hero" aria-labelledby="hero-title" data-od-id="hero">
  <div className="hero-copy">
   <p className="eyebrow"><span className="tiny-cross" aria-hidden="true"></span> A personal stablecoin treasury agent</p>
   <h1 id="hero-title"><span>Your rules.</span><span>Every move</span><span><em>explained.</em></span></h1>
   <p className="lead">Set aside what you need. Give Falcon a budget. See the evidence behind every decision.</p>
   <div className="od-cluster hero-actions"><a className="button primary" href="#decisions">Explore decisions <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></a><a className="text-link" href="#capital">Follow the capital <span aria-hidden="true">↓</span></a></div>
   <p className="hero-note">Current prototype: synthetic USDC and simulated actions.</p>
  </div>
  <figure className="capital-visual" id="capital" aria-labelledby="capital-caption" data-od-id="capital-map">
   <figcaption className="visual-rail" id="capital-caption"><span className="eyebrow">00 / CAPITAL LEDGER</span><span className="tag amber">Simulation</span></figcaption>
   <div className="ledger-total"><div className="od-stat"><span className="micro">Synthetic treasury scenario</span><span className="hero-total od-nowrap">1,000</span><span className="micro">Fixed example mandate</span></div><span className="ledger-unit">USDC</span></div>
   <table className="ledger-table"><caption className="sr-only">The example balance split into owner cash and an agent budget.</caption><thead><tr><th scope="col">ALLOCATION</th><th scope="col">USDC</th><th scope="col">SHARE</th></tr></thead><tbody>
    <tr className="ledger-row"><td><div className="od-field"><span className="ledger-code">01 / RESERVE</span><span className="ledger-name">Spending cash</span></div></td><td className="ledger-cell">200</td><td className="ledger-share">20%</td></tr>
    <tr className="ledger-row"><td><div className="od-field"><span className="ledger-code">02 / CASH</span><span className="ledger-name">Undelegated</span></div></td><td className="ledger-cell">300</td><td className="ledger-share">30%</td></tr>
    <tr className="ledger-row"><td><div className="od-field"><span className="ledger-code">03 / DELEGATED</span><span className="ledger-name">Agent budget</span></div></td><td className="ledger-cell">500</td><td className="ledger-share">50%</td></tr>
   </tbody></table>
   <div className="ledger-partition" aria-hidden="true"><span style={{"--weight": 200, "--bucket-color": "var(--fg)"}}></span><span style={{"--weight": 300, "--bucket-color": "var(--cash)"}}></span><span style={{"--weight": 500, "--bucket-color": "var(--accent)"}}></span></div>
   <div className="ledger-footer"><span className="micro">500 USDC outside<br />agent authority</span><span className="micro">500 USDC within<br />the agent budget</span></div>
  </figure>
 </section>
 <div className="container hero-foot"><div className="process-mini"><span><b>01</b> Set boundaries</span><span><b>02</b> Follow the evidence</span><span><b>03</b> Inspect the outcome</span></div><span className="micro">Owner rules → agent decisions</span></div>

</>; }

export function Readiness() { return <>
 <section className="container section readiness" id="readiness" aria-labelledby="readiness-title" data-od-id="readiness">
  <div className="section-heading"><div><span className="section-index">02 / THE PATH TO REAL CAPITAL</span><h2 id="readiness-title" tabIndex="-1">Start small.<br /><em>Prove each step.</em></h2></div><p>Simulation first. Execution follows evidence.</p></div>
  <div className="readiness-strip">
   <article className="readiness-step"><div className="readiness-top"><span className="stage-mark">01</span><span className="tag accent">Current prototype</span></div><h3>A local treasury simulation</h3><p>Fixed rules, synthetic observations, and inspectable decisions.</p></article>
   <article className="readiness-step"><div className="readiness-top"><span className="stage-mark">02</span><span className="tag amber">In progress</span></div><h3>The complete decision graph</h3><p>Evidence, history, and replay across the full product flow.</p></article>
   <article className="readiness-step"><div className="readiness-top"><span className="stage-mark">03</span><span className="tag">Future proof</span></div><h3>Devnet, then a funded test</h3><p>Supply, redemption, and restricted authority must be proved first.</p></article>
  </div>
  <div className="product-links"><a className="text-link" href="/dashboard/">Open Control Centre <span aria-hidden="true">↗</span></a><a className="text-link" href="/mesh/">Open knowledge mesh <span aria-hidden="true">↗</span></a><a className="text-link" href="/treasury/">Open treasury simulation <span aria-hidden="true">↗</span></a></div>
  <details className="legacy"><summary>Earlier advisory previews</summary><div className="legacy-body"><p>These previews explore FalconOS's earlier investment council direction. They are separate from this treasury simulation.</p><div className="legacy-links"><a className="text-link" href="/product/">Portfolio workspace <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></a><a className="text-link" href="/research/">Knowledge <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></a></div></div></details>
 </section>

</>; }

export function Closing() { return <>
 <section className="closing" data-od-id="closing"><div className="container closing-inner"><div><p className="eyebrow">Every decision has a trail</p><h2>Follow the decision.<br /><em>All the way through.</em></h2></div><a className="button primary" href="#decisions">Explore the simulation <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></a></div></section>

</>; }

export function Footer() { return <>
<footer className="site-footer"><div className="container footer-inner"><a className="brand" href="#top" aria-label="FalconOS home"><svg className="brand-symbol" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M30 194L171 39L129 151Z"/><path d="M138 195L218 70L190 195Z"/></svg><span className="falcon-wordmark" aria-hidden="true"><span>FALCON</span><span className="wordmark-os">OS</span></span></a><p>Personal treasury. Current preview uses synthetic USDC.</p><a className="text-link" href="#top">Back to top ↑</a></div></footer>

</>; }
