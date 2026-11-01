import asyncio
from playwright.async_api import async_playwright
FAKE = """
window.Worker = class {
  postMessage(m) {
    const send = d => setTimeout(() => this.onmessage && this.onmessage({ data: d }), 25);
    if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
    if (m.type === 'encode') { window.__enc = {w:m.w,h:m.h}; send({ type:'encoded', id:m.id, ms:5 }); }
    if (m.type === 'decode') {
      const gw = 256, gh = 256;
      const logits = [0.6, 1, 1.6].map(s => {
        const lg = new Float32Array(gw*gh).fill(-8);
        const p = m.points[0];
        for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
          // blocky square-ish blob (staircase) around the click, plus a stray speck far away
          const bx = Math.floor(x/8)*8, by = Math.floor(y/8)*8;
          if (Math.hypot(bx - p.x*gw, by - p.y*gh) < 30*s) lg[y*gw+x] = 8;
          if (Math.hypot(x - 230, y - 30) < 4) lg[y*gw+x] = 8;
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
        pg = await b.new_page(viewport={"width":1280,"height":900})
        errs=[]
        pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
        pg.on("console", lambda m: errs.append(m.type+": "+m.text) if m.type=="error" and "ERR_TUNNEL" not in m.text else None)
        await pg.add_init_script(FAKE)
        await pg.goto("file:///home/claude/photo-editor/index.html")
        await pg.wait_for_timeout(1500)
        await pg.click("#selectMode"); await pg.wait_for_timeout(400)
        box = await pg.locator("#frame").bounding_box()
        x, y = box["x"]+box["width"]*0.3, box["y"]+box["height"]*0.6
        await pg.mouse.move(x, y); await pg.wait_for_timeout(300)
        await pg.mouse.click(x, y); await pg.wait_for_timeout(800)
        print("selection:", await pg.text_content("#tgtLocal"))
        await pg.screenshot(path="p_refined.png")
        # hue slider present and works on selection
        await pg.click("#selectMode"); await pg.wait_for_timeout(200)
        await pg.fill("#ctl-hue", "120"); await pg.dispatch_event("#ctl-hue", "input"); await pg.wait_for_timeout(300)
        print("hue output:", await pg.text_content("#ctl-hue + output, .ctl:has(#ctl-hue) output"))
        await pg.screenshot(path="q_hue.png")
        print("errors:", errs)
        await b.close()
asyncio.run(main())
