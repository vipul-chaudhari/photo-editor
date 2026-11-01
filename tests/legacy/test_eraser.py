import asyncio
from playwright.async_api import async_playwright
FAKE = """
window.__runs = [];
window.Worker = class {
  postMessage(m) {
    const send = (d, tr) => setTimeout(() => this.onmessage && this.onmessage({ data: d }), 40);
    if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
    if (m.type === 'run' && m.img) {           // eraser: fill hole with pure green
      const n = m.w * m.h, out = new Uint8Array(3 * n); out.set(m.img);
      let holes = 0;
      for (let i = 0; i < n; i++) if (m.mask[i] === 0) { out[i] = 0; out[n + i] = 255; out[2 * n + i] = 0; holes++; }
      window.__runs.push({ w: m.w, h: m.h, holes });
      send({ type:'result', job:m.job, data:out, ms:1500 });
    } else if (m.type === 'run') {             // background matte: centre ellipse
      const W = 1024, H = 1024, u8 = new Uint8Array(W*H);
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const dx=(x-512)/200, dy=(y-512)/200; u8[y*W+x] = dx*dx+dy*dy < 1 ? 255 : 0; }
      send({ type:'matte', id:m.id, w:W, h:H, data:u8, ms:900 });
    }
  }
  terminate() {}
};
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width":1280,"height":900})
        errs=[]
        pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
        pg.on("console", lambda m: errs.append(m.type+": "+m.text) if m.type=="error" and "ERR_TUNNEL" not in m.text else None)
        await pg.add_init_script(FAKE)
        await pg.goto("file:///home/claude/photo-editor/index.html")
        await pg.wait_for_timeout(1500)
        async def px(fx, fy):
            await pg.click("#export"); await pg.wait_for_timeout(2500)
            r = await pg.evaluate(f"""async () => {{
              const im = document.getElementById('exportImg'); await im.decode();
              const c = new OffscreenCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d'); x.drawImage(im,0,0);
              return Array.from(x.getImageData({fx}*c.width|0, {fy}*c.height|0, 1, 1).data);
            }}""")
            await pg.click("#closeSheet"); await pg.wait_for_timeout(200)
            return r
        print("before:", await px(0.3, 0.3))
        await pg.click("#eraseMode"); await pg.wait_for_timeout(300)
        box = await pg.locator("#frame").bounding_box()
        P = lambda fx, fy: (box["x"]+box["width"]*fx, box["y"]+box["height"]*fy)
        await pg.mouse.move(*P(0.25,0.3)); await pg.mouse.down(); 
        for k in range(10): await pg.mouse.move(*P(0.25+0.01*k, 0.3))
        await pg.screenshot(path="n_brush.png")
        await pg.mouse.up(); await pg.wait_for_timeout(800)
        print("runs:", await pg.evaluate("__runs"), "| undo enabled:", not await pg.is_disabled("#undoErase"))
        print("after erase (stroke):", await px(0.3, 0.3), "| untouched:", await px(0.7, 0.7))
        await pg.click("#undoErase"); await pg.wait_for_timeout(400)
        print("after undo:", await px(0.3, 0.3))
        # erase selection via background matte -> selection
        await pg.click("#eraseMode"); await pg.wait_for_timeout(200)
        await pg.click("#bgRemove"); await pg.wait_for_timeout(800)
        await pg.click("[data-bg='0']"); await pg.wait_for_timeout(200)
        await pg.click("#bgToSel"); await pg.wait_for_timeout(400)
        print("eraseSel enabled:", not await pg.is_disabled("#eraseSel"))
        await pg.click("#eraseSel"); await pg.wait_for_timeout(1200)
        print("runs:", await pg.evaluate("__runs.length"), "| centre after erase selection:", await px(0.5, 0.5), "| selection:", await pg.text_content("#tgtLocal"))
        await pg.screenshot(path="o_erased.png")
        print("errors:", errs)
        await b.close()
asyncio.run(main())
