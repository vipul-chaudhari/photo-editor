import asyncio
from playwright.async_api import async_playwright
FAKE = """
window.Worker = class {
  postMessage(m) {
    const send = d => setTimeout(() => this.onmessage && this.onmessage({ data: d }), 30);
    if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
    if (m.type === 'run') {
      const W = 1024, H = 1024, u8 = new Uint8Array(W*H);
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const dx=(x-512)/300, dy=(y-560)/380; u8[y*W+x] = dx*dx+dy*dy < 1 ? 255 : 0; }
      send({ type:'matte', id:m.id, w:W, h:H, data:u8, ms:1400 });
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
        await pg.click("#bgRemove"); await pg.wait_for_timeout(800)
        print("tag:", await pg.text_content("#bgTag"), "| options visible:", await pg.is_visible("#bgOptions"), "| pressed:", await pg.get_attribute("[data-bg='1']","aria-pressed"))
        await pg.screenshot(path="l_transparent.png")
        async def export_px():
            await pg.click("#export"); await pg.wait_for_timeout(2500)
            r = await pg.evaluate("""async () => {
              const im = document.getElementById('exportImg'); await im.decode();
              const c = new OffscreenCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d'); x.drawImage(im,0,0);
              const at = (fx,fy) => Array.from(x.getImageData(fx*c.width|0, fy*c.height|0, 1, 1).data);
              return { corner: at(0.05,0.05), center: at(0.5,0.55), note: document.getElementById('exportNote').textContent.slice(0,60) };
            }""")
            await pg.click("#closeSheet"); await pg.wait_for_timeout(200)
            return r
        print("transparent:", await export_px())
        await pg.click("[data-bg='2']"); await pg.wait_for_timeout(200)
        await pg.click("#swatches button:nth-child(6)"); await pg.wait_for_timeout(300)
        print("colour red:", await export_px())
        await pg.click("[data-bg='3']"); await pg.wait_for_timeout(300)
        await pg.screenshot(path="m_blur.png")
        print("blur:", await export_px())
        await pg.click("[data-bg='0']"); await pg.wait_for_timeout(300)
        print("original:", await export_px())
        await pg.click("#bgToSel"); await pg.wait_for_timeout(400)
        print("to selection:", await pg.text_content("#tgtLocal"), await pg.get_attribute("#tgtLocal","aria-pressed"))
        await pg.set_viewport_size({"width":390,"height":844}); await pg.wait_for_timeout(500)
        print("phone scrollWidth:", await pg.evaluate("document.documentElement.scrollWidth"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
