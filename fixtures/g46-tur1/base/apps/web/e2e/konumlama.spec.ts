import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "390x844 (mobil)", width: 390, height: 844 },
  { name: "1280x800 (masaüstü)", width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test(`Menu konumlama: ${vp.name} ekranın 4 köşesinde getBoundingClientRect görünür alanda`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // Floating UI mantığını test eden bağımsız birim sayfası
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="tr">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Konumlama Testi</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { width: ${vp.width}px; height: ${vp.height}px; overflow: hidden; position: relative; font-family: sans-serif; }
            .btn {
              position: absolute;
              padding: 8px 12px;
              background: #333;
              color: #fff;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            }
            #btn-top-left { top: 10px; left: 10px; }
            #btn-top-right { top: 10px; right: 10px; }
            #btn-bottom-left { bottom: 10px; left: 10px; }
            #btn-bottom-right { bottom: 10px; right: 10px; }

            .menu {
              position: fixed;
              background: #222;
              color: #fff;
              border: 1px solid #444;
              border-radius: 6px;
              padding: 8px;
              min-width: 180px;
              display: flex;
              flex-direction: column;
              gap: 4px;
              z-index: 1000;
              overflow-y: auto;
            }
            .item {
              padding: 6px 12px;
              background: #333;
              border-radius: 4px;
              white-space: nowrap;
            }
          </style>
          <script src="https://cdn.jsdelivr.net/npm/@floating-ui/core@1.6.8"></script>
          <script src="https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.6.12"></script>
        </head>
        <body>
          <button id="btn-top-left" class="btn">Sol Üst</button>
          <button id="btn-top-right" class="btn">Sağ Üst</button>
          <button id="btn-bottom-left" class="btn">Sol Alt</button>
          <button id="btn-bottom-right" class="btn">Sağ Alt</button>
          <div id="test-menu" class="menu" style="display: none;">
            <div class="item">Öğe 1</div>
            <div class="item">Öğe 2</div>
            <div class="item">Öğe 3</div>
            <div class="item">Öğe 4</div>
            <div class="item">Öğe 5</div>
          </div>

          <script>
            const menu = document.getElementById("test-menu");

            function positionMenu(referenceEl) {
              const compute = window.FloatingUIDOM ? window.FloatingUIDOM.computePosition : null;
              if (!compute) {
                // CDN yoksa yerel matematiksel fallback (flip + shift + size)
                const r = referenceEl.getBoundingClientRect();
                const menuW = 180;
                const menuH = 160;
                let top = r.bottom + 4;
                let left = r.left;

                if (top + menuH > window.innerHeight - 8) {
                  top = Math.max(8, r.top - menuH - 4);
                }
                if (left + menuW > window.innerWidth - 8) {
                  left = Math.max(8, window.innerWidth - menuW - 8);
                }
                menu.style.left = left + "px";
                menu.style.top = top + "px";
                menu.style.maxWidth = (window.innerWidth - 16) + "px";
                menu.style.maxHeight = (window.innerHeight - 16) + "px";
                menu.style.display = "flex";
                return;
              }

              const { flip, shift, size, offset } = window.FloatingUIDOM;
              compute(referenceEl, menu, {
                placement: "bottom-start",
                strategy: "fixed",
                middleware: [
                  offset(4),
                  flip({ padding: 8 }),
                  shift({ padding: 8 }),
                  size({
                    padding: 8,
                    apply({ availableWidth, availableHeight, elements }) {
                      Object.assign(elements.floating.style, {
                        maxWidth: Math.max(0, Math.floor(availableWidth)) + "px",
                        maxHeight: Math.max(0, Math.floor(availableHeight)) + "px",
                      });
                    },
                  }),
                ],
              }).then(({ x, y }) => {
                menu.style.left = x + "px";
                menu.style.top = y + "px";
                menu.style.display = "flex";
              });
            }

            document.querySelectorAll(".btn").forEach((btn) => {
              btn.addEventListener("click", () => positionMenu(btn));
            });
          </script>
        </body>
      </html>
    `);

    const buttons = ["#btn-top-left", "#btn-top-right", "#btn-bottom-left", "#btn-bottom-right"];

    for (const btnSelector of buttons) {
      await page.click(btnSelector);
      await page.waitForSelector("#test-menu", { state: "visible" });

      const rect = await page.evaluate(() => {
        const el = document.getElementById("test-menu");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      });

      expect(rect).not.toBeNull();
      if (!rect) continue;

      // Tamamı görünür alanda olmalı (padding payı: 0px veya daha büyük)
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(vp.width);
      expect(rect.bottom).toBeLessThanOrEqual(vp.height);
    }
  });
}
