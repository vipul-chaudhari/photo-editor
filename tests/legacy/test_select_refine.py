import asyncio
from playwright.async_api import async_playwright
# Fake SAM: each include point adds a disc (r=30 grid px), each exclude point removes a disc (r=18).
# Three proposals: radii x0.6, x1, x1.6 so we can test size switching.
FAKE = """
window.__decodes = [];
window.Worker = class {
  postMessage(m) {
    const send = (d, t) => setTimeout(() => this.onmessage && this.onmessage({ data: d }), 25);
    if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true });
    if (m.type === 'encode') { window.__enc = {w:m.w,h:m.h}; send({ type:'encoded', id:m.id, ms:5 }); }
    if (m.type === 'decode') {
      window.__decodes.push({hover:m.hover, n:m.points.length, labels:m.points.map(p=>p.label).join('')});
      const gw = 256, gh = Math.round(256 * window.__enc.h / window.__enc.w);
      const logits = [0.6, 1, 1.6].map(s => {
        const lg = new Float32Array(gw*gh).fill(-5);
        for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
          let v = -5;
          for (const p of m.points) { const d = Math.hypot(x-p.x*gw, y-p.y*gh); if (p.label===1) v = Math.max(v, (30*s - d)*0.8); }
          for (const p of m.points) { const d = Math.hypot(x-p.x*gw, y-p.y*gh); if (p.label===0 && d < 18) v = Math.min(v, (d-18)*0.8); }
          lg[y*gw+x] = v;
        }
        return lg;
      });
      send({ type:'mask', id:m.id, hover:m.hover, key:m.key, gw, gh, logits, scores:[0.8,0.95,0.7], best:1 });
    }
  }
  terminate() {}
};
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width":1280,"height":800})
        errs=[]
        pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
        await pg.add_init_script(FAKE)
        await pg.goto("file:///home/claude/photo-editor/index.html")
        await pg.wait_for_timeout(1500)
        await pg.click("#selectMode"); await pg.wait_for_timeout(400)
        box = await pg.locator("#frame").bounding_box()
        P = lambda fx, fy: (box["x"]+box["width"]*fx, box["y"]+box["height"]*fy)
        pct = lambda: pg.text_content("#tgtLocal")
        x,y = P(0.5,0.5)
        await pg.mouse.move(x,y); await pg.wait_for_timeout(300)
        await pg.mouse.click(x,y); await pg.wait_for_timeout(300)
        print("1 include:", await pct(), "| size:", await pg.text_content("#sizeNote"))
        # scroll up -> Whole
        await pg.mouse.wheel(0,-100); await pg.wait_for_timeout(300)
        print("scroll up:", await pct(), "|", await pg.inner_html("#sizeNote"))
        await pg.mouse.wheel(0,100); await pg.wait_for_timeout(200)
        # exclude a part at the edge of the disc
        ex,ey = P(0.5+30/256*0.8, 0.5)
        await pg.keyboard.down("Alt"); await pg.mouse.move(ex,ey); await pg.wait_for_timeout(300); await pg.mouse.click(ex,ey); await pg.keyboard.up("Alt"); await pg.wait_for_timeout(300)
        print("after alt-click:", await pct())
        await pg.screenshot(path="j_refine.png")
        # undo
        await pg.click("#undoPt"); await pg.wait_for_timeout(300)
        print("after undo:", await pct())
        # shift-click new object far away
        sx,sy = P(0.15,0.2)
        await pg.keyboard.down("Shift"); await pg.mouse.move(sx,sy); await pg.wait_for_timeout(300); await pg.mouse.click(sx,sy); await pg.keyboard.up("Shift"); await pg.wait_for_timeout(300)
        print("after shift new object:", await pct())
        await pg.screenshot(path="k_two.png")
        await pg.click("#selectMode"); await pg.wait_for_timeout(300)
        print("done selecting:", await pct(), "| undo disabled:", await pg.is_disabled("#undoPt"))
        print("decodes:", await pg.evaluate("__decodes.filter(d=>!d.hover).map(d=>d.labels)"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
