import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width":1280,"height":800})
        errs=[]
        pg.on("pageerror", lambda e: errs.append("pageerror: "+str(e)))
        pg.on("console", lambda m: errs.append(m.type+": "+m.text) if m.type=="error" and "ERR_TUNNEL" not in m.text else None)
        await pg.goto("file:///home/claude/photo-editor/index.html")
        await pg.wait_for_timeout(2000)
        print("meta:", await pg.text_content("#meta"))
        # global preset still works
        await pg.click(".filter:nth-child(4)"); await pg.wait_for_timeout(300)
        print("punch:", await pg.evaluate("[...document.querySelectorAll('.ctl output')].map(o=>o.textContent).join(' ')"))
        # Simulate a selection directly (AI unreachable here): select the left half
        await pg.evaluate("""() => { const t = document.getElementById('tgtLocal'); return t.disabled }""")
        # click Select objects -> AI fails offline -> error state
        await pg.click("#selectMode"); await pg.wait_for_timeout(6000)
        print("ai status:", await pg.text_content("#aiText"), "| pressed:", await pg.get_attribute("#selectMode","aria-pressed"))
        print("errors:", errs)
        await pg.screenshot(path="f_aifail.png")
        await b.close()
asyncio.run(main())
