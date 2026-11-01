import asyncio
from playwright.async_api import async_playwright
FAKE = """
window.Worker = class {
  constructor() { setTimeout(()=>{}, 0); }
  postMessage(m) {
    const send = d => setTimeout(() => this.onmessage && this.onmessage({ data: d }), 30);
    if (m.type === 'load') { send({type:'progress', file:'a', loaded:5e6, total:2e7}); send({ type:'ready', device:'CPU (WebAssembly)', cached:false }); }
    if (m.type === 'encode') { window.__enc = {w:m.w,h:m.h, px: Array.from(m.rgb.slice(0,6))}; send({ type:'encoded', id:m.id, ms:5 }); }
    if (m.type === 'decode') {
      const gw = 256, gh = Math.round(256 * window.__enc.h / window.__enc.w), lg = new Float32Array(gw*gh);
      const cx = m.x*gw, cy = m.y*gh;
      for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) lg[y*gw+x] = (30 - Math.hypot(x-cx,y-cy)) * 0.8;
      send({ type:'mask', id:m.id, hover:m.hover, op:m.op, x:m.x, y:m.y, gw, gh, logits: lg });
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
        pg.on("console", lambda m: errs.append(m.type+": "+m.text) if m.type in ("error","warning") and "ERR_TUNNEL" not in m.text else None)
        await pg.add_init_script(FAKE)
        await pg.goto("file:///home/claude/photo-editor/index.html")
        await pg.wait_for_timeout(1500)
        await pg.click("#selectMode"); await pg.wait_for_timeout(500)
        print("enc:", await pg.evaluate("window.__enc && {w:__enc.w,h:__enc.h,px:__enc.px}"))
        box = await pg.locator("#frame").bounding_box()
        # hover then click the sun area (right-centre)
        hx, hy = box["x"]+box["width"]*0.68, box["y"]+box["height"]*0.55
        await pg.mouse.move(hx, hy); await pg.wait_for_timeout(300)
        await pg.screenshot(path="g_hover.png")
        await pg.mouse.click(hx, hy); await pg.wait_for_timeout(400)
        print("target btn:", await pg.text_content("#tgtLocal"), await pg.get_attribute("#tgtLocal","aria-pressed"))
        # second object: left pines, then alt-click to remove part
        await pg.mouse.click(box["x"]+box["width"]*0.15, box["y"]+box["height"]*0.5); await pg.wait_for_timeout(400)
        print("after 2:", await pg.text_content("#tgtLocal"))
        await pg.keyboard.down("Alt"); await pg.mouse.click(box["x"]+box["width"]*0.15, box["y"]+box["height"]*0.5); await pg.keyboard.up("Alt"); await pg.wait_for_timeout(400)
        print("after alt:", await pg.text_content("#tgtLocal"))
        await pg.screenshot(path="h_selected.png")
        # Leave select mode, apply Mono to selection only
        await pg.click("#selectMode"); await pg.wait_for_timeout(200)
        await pg.click(".filter:nth-child(7)"); await pg.wait_for_timeout(500)
        print("vignette disabled:", await pg.is_disabled("#ctl-vignette"))
        await pg.screenshot(path="i_local_mono.png")
        # pixel check via export: inside selection grey, outside colourful
        await pg.click("#export"); await pg.wait_for_timeout(2500)
        stats = await pg.evaluate("""async () => {
          const im = document.getElementById('exportImg'); await im.decode();
          const c = new OffscreenCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d'); x.drawImage(im,0,0);
          const sat = (px,py) => { const d = x.getImageData(px*c.width|0, py*c.height|0, 1, 1).data; return Math.max(d[0],d[1],d[2]) - Math.min(d[0],d[1],d[2]); };
          return { inside: sat(0.68,0.55), removed: sat(0.15 - 0.105, 0.5), outsideSky: sat(0.68,0.2), outsideWater: sat(0.5, 0.9) };
        }""")
        print("chroma:", stats)
        await pg.keyboard.press("Escape")
        # switch back to whole photo; sliders should show global values
        await pg.click("#tgtGlobal"); await pg.wait_for_timeout(300)
        print("global sliders:", await pg.evaluate("[...document.querySelectorAll('.ctl output')].map(o=>o.textContent).join(' ')"))
        await pg.click("#clearSel"); await pg.wait_for_timeout(300)
        print("after clear:", await pg.text_content("#tgtLocal"), await pg.is_disabled("#tgtLocal"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
