/* A procedurally painted lakeside dusk scene, so the editor opens with something to edit. */
export function samplePhoto(): HTMLCanvasElement {
  const W = 1600, H = 1067;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const horizon = 690;

  const sky = x.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#1f3866"); sky.addColorStop(0.45, "#5a6f9e"); sky.addColorStop(0.78, "#e3a26e"); sky.addColorStop(1, "#f7d6a6");
  x.fillStyle = sky; x.fillRect(0, 0, W, horizon);

  const sun = x.createRadialGradient(1080, 600, 10, 1080, 600, 340);
  sun.addColorStop(0, "rgba(255,246,220,1)"); sun.addColorStop(0.12, "rgba(255,226,170,0.9)"); sun.addColorStop(1, "rgba(255,190,120,0)");
  x.fillStyle = sun; x.fillRect(0, 0, W, horizon);

  for (let i = 0; i < 9; i++) { // soft clouds
    x.fillStyle = `rgba(255,${200 + rnd() * 40 | 0},${170 + rnd() * 40 | 0},${0.08 + rnd() * 0.1})`;
    x.beginPath(); x.ellipse(rnd() * W, 120 + rnd() * 330, 140 + rnd() * 220, 14 + rnd() * 22, 0, 0, Math.PI * 2); x.fill();
  }

  const ridge = (base: number, amp: number, rough: number, color: string) => {
    x.fillStyle = color; x.beginPath(); x.moveTo(0, horizon);
    let y = base;
    for (let px = 0; px <= W; px += 16) { y += (rnd() - 0.5) * rough; y = Math.max(base - amp, Math.min(base + amp * 0.4, y)); x.lineTo(px, y); }
    x.lineTo(W, horizon); x.closePath(); x.fill();
  };
  ridge(560, 120, 40, "#7a7898");
  ridge(610, 110, 46, "#545571");
  ridge(650, 70, 34, "#34364a");

  x.save(); x.translate(0, horizon * 2); x.scale(1, -1); // reflection
  x.drawImage(c, 0, 0, W, horizon, 0, 0, W, horizon);
  x.restore();
  const water = x.createLinearGradient(0, horizon, 0, H);
  water.addColorStop(0, "rgba(20,30,55,0.25)"); water.addColorStop(1, "rgba(10,16,32,0.75)");
  x.fillStyle = water; x.fillRect(0, horizon, W, H - horizon);
  for (let i = 0; i < 260; i++) {
    const yy = horizon + 4 + rnd() * (H - horizon);
    x.fillStyle = `rgba(255,235,200,${0.04 + rnd() * 0.08})`;
    x.fillRect(rnd() * W, yy, 30 + rnd() * 160, 1.5);
  }

  x.fillStyle = "#151824"; // shoreline pines
  for (let i = 0; i < 26; i++) {
    const tx = i * 18 + rnd() * 10, th = 120 + rnd() * 160, tw = 22 + rnd() * 16;
    x.beginPath(); x.moveTo(tx, horizon + 6); x.lineTo(tx + tw / 2, horizon + 6 - th); x.lineTo(tx + tw, horizon + 6); x.fill();
  }
  x.fillRect(0, horizon - 2, 520, 14);

  const d = x.getImageData(0, 0, W, H), a = d.data; // film grain
  for (let i = 0; i < a.length; i += 4) { const n = (rnd() - 0.5) * 10; a[i] += n; a[i + 1] += n; a[i + 2] += n; }
  x.putImageData(d, 0, 0);
  return c;
}
