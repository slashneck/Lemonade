// Lemonade mark: a lemon slice that doubles as a spinning record.
(function (root) {
  const C = 50;
  const pt = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  };
  const deg = (rad) => (rad * 180) / Math.PI;

  function wedgePaths({ count = 8, rIn = 9, rOut = 34, gap = 2.7 } = {}) {
    const step = 360 / count;
    const out = [];
    for (let i = 0; i < count; i++) {
      const t0 = i * step, t1 = (i + 1) * step;
      const dIn = deg(Math.asin(gap / rIn)), dOut = deg(Math.asin(gap / rOut));
      out.push(
        `M ${pt(rIn, t0 + dIn)} L ${pt(rOut, t0 + dOut)} A ${rOut} ${rOut} 0 0 1 ${pt(rOut, t1 - dOut)} ` +
        `L ${pt(rIn, t1 - dIn)} A ${rIn} ${rIn} 0 0 0 ${pt(rIn, t0 + dIn)} Z`
      );
    }
    return out;
  }

  // Inline SVG for the app UI (colors come from CSS: currentColor + var(--accent)).
  function markup({ size = 28, cls = '' } = {}) {
    const wedges = wedgePaths()
      .map((d, i) => `<path class="lm-wedge" style="--i:${i}" d="${d}"/>`)
      .join('');
    return `<svg class="lemon-logo ${cls}" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
      <g class="lm-spin">
        <circle class="lm-rind" cx="50" cy="50" r="44" pathLength="100"/>
        <circle class="lm-groove" cx="50" cy="50" r="39"/>
        <g class="lm-wedges">${wedges}</g>
      </g></svg>`;
  }

  // Standalone SVG used to render the app icon.
  function iconSvg({ bg = '#0b0b0b', rind = '#f4f4f4', accent = '#ffd60a', rounded = true } = {}) {
    const wedges = wedgePaths().map((d) => `<path d="${d}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  ${rounded ? `<rect width="100" height="100" rx="22" fill="${bg}"/>` : ''}
  <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
    <circle cx="50" cy="50" r="44" fill="none" stroke="${rind}" stroke-width="5.5"/>
    <circle cx="50" cy="50" r="39" fill="none" stroke="${rind}" stroke-opacity="0.28" stroke-width="1.2"/>
    <g fill="${accent}" stroke="${accent}" stroke-width="2" stroke-linejoin="round">${wedges}</g>
  </g>
</svg>`;
  }

  const api = { markup, iconSvg, wedgePaths };
  root.LemonLogo = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
