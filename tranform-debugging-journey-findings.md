# Transform Debugging Journey & Findings: HTML-in-Canvas in *The Rainforest of Information*

**Date:** October 21, 2026  
**Project:** [`The Rainforest of Information`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/app.js)  
**Target API:** HTML-in-Canvas (`content="drawable"` / `layoutsubtree`, `drawable`, `texElementSubImage2D`, `updateElementGeometry`, `getElementTransform`)

---

## 1. Executive Summary

While *The Rainforest of Information* successfully captured live HTML DOM cards (`<article class="hic-leaf-card" drawable>`) and textured them onto 3D sculpted, origami-unfurling Three.js leaves using `gl.texElementSubImage2D()`, **none of the rendered leaf UI elements were properly interactable**:
- Users could not drag their cursor across the rendered 3D leaf text to highlight/select it.
- Users could not click on the visual buttons, quiz choices, or form inputs on the 3D leaves.
- Later in the debugging journey, when interaction finally began responding, the hit-testing region was shifted halfway toward the top-left corner of the viewport on Retina (`devicePixelRatio = 2`) displays—causing a drag near the top margin of the leaf to select the `<h1>`/`<h2>` title text in the middle of the leaf.

Ultimately, **five compounding bugs** across Three.js scene-graph synchronization, perspective matrix math, browser API version drift (Chrome 155 implementation vs. spec/docs), high-DPI coordinate spaces, and DOM readout selectors were responsible for the failure. Resolving all of them required moving from static code inspection to live Chrome DevTools Protocol (CDP) inspection with visual bounding-box overlays and synthetic mouse-drag/click verification at `devicePixelRatio = 2`.

---

## 2. Anatomy of What Went Wrong (The 5 Compounding Root Causes)

### Root Cause #1: Un-normalized 4×4 Perspective `DOMMatrix` & Inverted Z-Axis in `computeCanvasTransform`
In the original [`computeCanvasTransform`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/app.js#L100-L112), the code followed a 3D matrix recipe (`clipToCanvasViewport.multiply(mvpDOM).multiply(toGLModel)`) where `mvpDOM` contained Three.js's perspective `projectionMatrix` (`m34 = -1`).
- In homogeneous coordinates, a perspective projection puts the camera-space depth $-z_{\text{eye}} \approx 9.02$ into `m44` (`w`), scaling all translation and scale components by $w$:
  - `m41 (e) = 3467.45` instead of `384.4px`
  - `m42 (f) = 2150.61` instead of `238.4px`
  - `m11 (a) = 8.10` instead of `0.90`
  - `m22 (d) = 10.05` instead of `1.11`
- Furthermore, multiplying three left-handed Y/Z-flipping matrices (`toGLModel` flips Y, `projectionMatrix` negates Z, `clipToCanvasViewport` flips Y) yielded a matrix with a **negative determinant (`det < 0`)** and **`m33 = -1.186 < 0`**, flipping the Z-normal of the transformed plane.
- Replacing the raw 4×4 homogeneous matrix multiplication with a clean, perspective-divided 2D affine `DOMMatrix` (`is2D === true`, `m33 = 1`, `m44 = 1`) computed from the projected CSS-pixel coordinates of the 3D leaf quad corners (`_pTL`, `_pTR`, `_pBL`, `_pBR` via `worldVec.project(camera)`) eliminated the homogeneous $w$-scaling and Z-inversion.

### Root Cause #2: Stale Parent `nodeGroup.matrixWorld` in Three.js Scene Graph
Each of the 8 leaves (`idx = 0..7`) is a child of a `nodeGroup` positioned vertically along the vine at `y = -idx * STEP_SPACING_Y` (`-9.0 * idx`).
- Inside [`updateSceneAndSyncDOM`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/app.js#L3699-L3889), [`syncInvisibleDOMHitLayer`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/app.js#L3648-L3736) executes **before** `renderer.render(scene, camera)` (which is where Three.js normally traverses the scene to update world matrices).
- Originally, `syncInvisibleDOMHitLayer` called `node.leafMesh.updateMatrixWorld()`. In Three.js, `Object3D.updateMatrixWorld()` only multiplies `this.parent.matrixWorld * this.matrix`—it does **not** update ancestor matrices (`node.nodeGroup.matrixWorld` or `leavesGroup.matrixWorld`)!
- Because `nodeGroup.visible` was `false` on startup for leaves `1..7`, `nodeGroup.matrixWorld` remained at the origin `(0, 0, 0)` when `camera.position.y` descended to `-9, -18, ..., -63`. As a result, leaves `1..7` were projected `-655px` to `-6184px` above the top of the screen.
- Switching to `node.leafMesh.updateWorldMatrix(true, false)` forced Three.js to update parent world matrices (`leavesGroup` and `node.nodeGroup`) prior to projecting the leaf vertices.

### Root Cause #3: Browser Implementation Drift in Chrome 155 (`updateElementGeometry` No-Op vs. `getElementTransform` + `style.transform`)
This was the single biggest reason why the first fix attempt failed:
- Both the latest specification documentation ([`html-in-canvas-documentation.txt`](file:///Users/nattestad/workspaces/hicProjects/html-in-canvas-documentation.txt)) and the `modern-web-guidance` skill (`interactive-content-in-3d-scenes`) instruct developers to call:
  ```js
  canvas.updateElementGeometry(element, { canvasTransform });
  ```
- However, inspecting the running Chrome 155.0.8059.40 binary (`--enable-features=CanvasDrawElement`) via CDP revealed that while `HTMLCanvasElement.prototype.updateElementGeometry` exists as a method on the prototype and does not throw an error, **it is a complete no-op for DOM hit-testing and layout positioning in Chrome 155**!
- Calling `canvas.updateElementGeometry(card0, { canvasTransform })` left `card0.getBoundingClientRect()` stuck at `{ x: 0, y: 0, width: 650, height: 356 }` in the top-left corner of the viewport.
- Worse, because all 8 `<article class="hic-leaf-card" drawable>` elements had `position: absolute; top: 0; left: 0`, inactive leaves that were not translated offscreen remained stacked at `(0, 0)`.
- In Chrome 155's implementation, actual DOM hit-testing and text-selection geometry for `<canvas layoutsubtree>` children is driven by **setting `element.style.transform`** (while `captureElementImage` / `texElementSubImage2D` captures the element's intrinsic untransformed paint record).

### Root Cause #4: The Retina / High-DPI (`devicePixelRatio = 2`) Half-Screen Offset in `canvas.getElementTransform()`
In Attempt #2, we used `canvas.getElementTransform(element, canvasTransform)` and assigned the result to `element.style.transform`.
- Our headless Chrome verification initially ran at `devicePixelRatio = 1` (`1440×900` backing buffer = `1440×900` CSS pixels), where `getElementTransform(element, canvasTransform)` returned the exact CSS matrix and all tests passed.
- However, on the user's macOS Retina display (`devicePixelRatio = 2`), `canvas.width` is `2880` while `canvas.clientWidth` is `1440`.
- In Chrome 155's C++ implementation, `canvas.getElementTransform(element, canvasTransform)` assumes `canvasTransform` is expressed in **canvas backing-store grid pixels** (`0..canvas.width`, `0..canvas.height`), and therefore pre-multiplies the matrix by `scale(clientWidth / canvas.width, clientHeight / canvas.height)` = `scale(0.5, 0.5)`!
- Because our `canvasTransform` was **already computed in CSS pixels** (`0..clientWidth`, `0..clientHeight`, as specified by the newer `updateElementGeometry` documentation), passing it through `getElementTransform()` divided the translation `(e, f)` by `2`:
  - Instead of placing the card at `(410px, 210px)`, it placed the card at `(205px, 105px)`!
  - Visually, `(205px, 105px)` put the DOM `<h1>` title box right across the upper-left edge of the 3D leaf—explaining why the user reported: *"When I drag just around near the top of the leaf it selects the title text of the card."*
- Applying the CSS-pixel `canvasTransform` directly to `element.style.transform = canvasTransform.toString()` (alongside `canvas.updateElementGeometry` for forward compatibility) aligned the DOM hit-boxes pixel-for-pixel with the WebGL leaf on both `DPR = 1` and `DPR = 2` displays.

### Root Cause #5: Mismatched DOM Readout IDs & `http-server` Caching
- Several button click handlers in [`executeLeafAction`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/app.js#L3148-L3269) and [`syncQuizDOM`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/app.js#L3078-L3124) referenced outdated element IDs (`#sloth-dance-feedback`, `#pod-blast-feedback`, `#spider-decoy-feedback`, `#quiz-explanation`, `.choice-text`) instead of the actual IDs in [`index.html`](file:///Users/nattestad/workspaces/hicProjects/Rainforest%20of%20Information/index.html) (`#sloth-stat-readout`, `#grenade-stat-readout`, `#decoy-stat-readout`, `#quiz-explanation-banner`, `.choice-label`). Even when a button click registered on Leaves 1, 2, 3, or 5, the DOM text did not mutate, so no visible change appeared on the 3D leaf texture.
- Additionally, `http-server` serves static files with `Cache-Control: max-age=3600` by default, meaning browser reloads without cache-busting query strings (`?v=...`) could serve stale `app.js` / `styles.css`.

---

## 3. Chronological Iteration Log: What Was Tried & Why Early Attempts Failed

| Iteration | Hypothesis & Changes Made | User Feedback / Outcome | Why It Didn't Fully Work Yet |
| :--- | :--- | :--- | :--- |
| **Attempt 1** *(Static Math & Spec Alignment)* | Fixed `node.leafMesh.updateWorldMatrix(true, false)`, replaced the un-normalized 3D `mvpDOM` matrix with a projected 2D affine `DOMMatrix` in CSS pixels, passed it to `canvas.updateElementGeometry(element, { canvasTransform })`, and cleared `element.style.transform = ''`. | *"The bug remains unfixed. I can't move my cursor over the text and drag to highlight it... and I also can't click any buttons."* | In Chrome 155, `canvas.updateElementGeometry()` is a no-op stub. Clearing `element.style.transform = ''` left every `<article drawable>` sitting at `(0, 0)` in the top-left corner of the screen! |
| **Attempt 2** *(CDP Inspection, `getElementTransform`, & Button ID Fixes)* | Connected to Chrome 155 via CDP, discovered `card0.getBoundingClientRect()` was stuck at `(0, 0)` after `updateElementGeometry`, and added `canvas.getElementTransform(element, canvasTransform)` + `element.style.transform = domTransform.toString()`. Also fixed the mismatched readout IDs (`#sloth-stat-readout`, etc.) and verified clicks/drags in headless Chrome (`DPR = 1`). | *"This is now closer but still not right. When I drag just around near the top of the leaf it selects the title text of the card. Is there perhaps an offset or something that isn't being applied...?"* | Headless Chrome defaulted to `devicePixelRatio = 1`, where `canvas.width === canvas.clientWidth`. On the user's `devicePixelRatio = 2` display, `canvas.getElementTransform()` multiplied the CSS-pixel translation by `clientWidth / canvas.width = 0.5`, shifting the hit box from `(410, 210)` to `(205, 105)`. |
| **Attempt 3** *(Retina `DPR = 2` Visual Overlay & Direct CSS Transform)* | Ran headless Chrome with `--force-device-scale-factor=2`, rendered neon debug borders around `card0.getBoundingClientRect()`, `h1.getBoundingClientRect()`, and `btn.getBoundingClientRect()` over a screenshot of the WebGL canvas, immediately saw the `0.5×` translation offset, and switched to `element.style.transform = canvasTransform.toString()` directly in CSS pixels. | *"Yes! It finally works fully. Way to go."* | N/A — Fixed and verified across all 8 leaves at `DPR = 2`. |

---

## 4. Evaluation of Reference Sources: Useful vs. Confusing

### What Was Useful
1. **[`html-in-canvas-documentation.txt`](file:///Users/nattestad/workspaces/hicProjects/html-in-canvas-documentation.txt) (Lines 912–926) & `WICG/html-in-canvas/Examples/webGL.html` (Lines 147–178)**:
   - Both showed that for a 3D WebGL scene, projecting the 3D quad's corners to screen space (dividing by homogeneous $w$) and constructing a **2D scale + translate `DOMMatrix`** (`a, d, e, f`) is far safer and more predictable than multiplying raw 4×4 perspective matrices into a 3D `DOMMatrix`.
2. **[`html-in-canvas-documentation.txt`](file:///Users/nattestad/workspaces/hicProjects/html-in-canvas-documentation.txt) (Lines 231–240 — PixiJS Integration Snippet)**:
   - Line 236 of `html-in-canvas-documentation.txt` actually contained a critical clue about how the older/transitional API worked:
     ```js
     this.element.style.transform =
       renderer.canvas.getElementTransform(this.element, canvasTransform).toString();
     ```
   - This snippet showed that `getElementTransform` returns a `DOMMatrix` meant to be assigned to `element.style.transform`, whereas `updateElementGeometry` is the newer replacement API.
3. **Chrome Binary Symbol Inspection (`strings`) & Live Headless Chrome CDP**:
   - Inspecting the actual Chrome 155 binary and running live `getBoundingClientRect()`, `document.elementFromPoint(x, y)`, and `Page.captureScreenshot` with `--force-device-scale-factor=2` provided ground-truth answers in seconds instead of guessing from spec prose.

### What Was Confusing or Misleading
1. **Silent No-Op of `canvas.updateElementGeometry()` in Chrome 155**:
   - In Chrome 155 (`--enable-features=CanvasDrawElement`), `typeof canvas.updateElementGeometry === 'function'` is `true`! Feature detection for `updateElementGeometry` succeeds, and calling `canvas.updateElementGeometry(el, { canvasTransform })` succeeds without throwing or logging a warning—yet it does nothing to the element's hit-test geometry.
   - Because `modern-web-guidance` (`interactive-content-in-3d-scenes`) and `html-in-canvas-documentation.txt` (Section 2, lines 686–926) teach `canvas.updateElementGeometry()` as the primary mechanism and state that `style.transform` is no longer needed, relying on feature detection (`typeof canvas.updateElementGeometry === 'function'`) actively broke Chrome 155 when `element.style.transform` was omitted.
2. **Conflicting Coordinate-Space Conventions Between `getElementTransform` (Canvas Grid Pixels) and `updateElementGeometry` (CSS Pixels)**:
   - In `WICG/html-in-canvas/Examples/webGL.html` (lines 154–178), `canvas_rect` is computed using `render_canvas.width` and `render_canvas.height` (canvas backing-buffer pixels) when used with `getElementTransform`, **or** `clientWidth` and `clientHeight` (CSS pixels) when `canvas.width === canvas.clientWidth`.
   - In `html-in-canvas-documentation.txt` (lines 912–926) and `modern-web-guidance` (`interactive-content-in-3d-scenes`), `canvasTransform` is explicitly documented as mapping **CSS pixels to CSS pixels** (`canvas.clientWidth`, `canvas.clientHeight`).
   - Mixing a CSS-pixel `canvasTransform` with `canvas.getElementTransform(el, canvasTransform)` on a Retina display (`canvas.width = 2 * canvas.clientWidth`) silently introduces a `1 / devicePixelRatio` translation offset!
3. **The `modern-web-guidance` 3D `computeCanvasTransform` Recipe (`interactive-content-in-3d-scenes`)**:
   - The `computeCanvasTransform` helper in `modern-web-guidance` multiplies `clipToCanvasViewport.multiply(mvpDOM).multiply(toGLModel)`.
   - When `mvp` is a standard WebGL perspective Model-View-Projection matrix (`m34 = -1`), the resulting `DOMMatrix` has `m44 = -z_eye != 1` (un-normalized homogeneous coordinates) and `m33 < 0` (flipped Z axis). If that `DOMMatrix` is serialized to CSS `element.style.transform = matrix3d(...)` or decomposed by a consumer that does not perspective-divide the translation columns by `m44`, the element is placed thousands of pixels offscreen.

---

## 5. Recommendations: How to Debug Faster & Improve Tooling / Skills

### A. Updates We Should Make to the `modern-web-guidance` Skill
1. **Document the Transitional Chrome 155 vs. Chrome 157+ Hit-Testing Behavior**:
   - In `interactive-content-in-3d-scenes.md` and `expose-canvas-content-to-browser-features.md`, warn explicitly that in transitional Chromium builds (such as Chrome 155), `canvas.updateElementGeometry` exists on `HTMLCanvasElement.prototype` as a no-op stub while `layoutSubtree` is active.
   - Recommend setting **both** `canvas.updateElementGeometry(el, { canvasTransform })` (for Chrome 157+) **and** `el.style.transform = canvasTransform.toString()` (where `el` has `position: absolute; top: 0; left: 0; transform-origin: 0 0` and `canvasTransform` is in CSS pixels) so hit-testing works across all Chromium versions without a `1 / dpr` offset.
2. **Replace or Fix the 3D `computeCanvasTransform` Helper in `interactive-content-in-3d-scenes.md`**:
   - Show how to project the 3D quad's corners into CSS viewport coordinates (`project(camera)` dividing by $w$) to construct a normalized 2D affine `DOMMatrix` (`a, b, c, d, e, f` with `m33 = 1, m44 = 1`), OR if a 3D `matrix3d` homography is desired, explicitly normalize all 16 entries by `1 / m44` and negate the 3rd column (`toGLModel.scale(1/w, -1/h, -1/h)`) so `det > 0` and `m33 > 0`.
3. **Warn Against Mixing `getElementTransform()` with CSS-Pixel Transforms on High-DPI (`devicePixelRatio > 1`) Canvases**:
   - Clarify that `getElementTransform()` divides translation by `canvas.width / canvas.clientWidth` (`devicePixelRatio`), whereas `updateElementGeometry()` and CSS `style.transform` operate in CSS pixels (`clientWidth × clientHeight`).
4. **Always Move Inactive Drawable Children Offscreen**:
   - When multiple `drawable` elements exist inside a `<canvas>`, calling `clearElementGeometry(el)` is not sufficient in browsers where `clearElementGeometry` is a stub. Always pair it with `el.style.transform = 'translate3d(-9999px, -9999px, 0)'`, `el.style.pointerEvents = 'none'`, and `el.setAttribute('inert', '')`.

### B. Better Instructions / Workflow for Debugging HTML-in-Canvas Transform Issues
1. **Check `element.getBoundingClientRect()` and `document.elementFromPoint(x, y)` Immediately in a Real Browser**:
   - Whenever a user reports that HTML-in-Canvas elements render visually on the canvas but cannot be clicked or highlighted, the **very first step** should be launching headless Chrome (with `--force-device-scale-factor=2`) and comparing:
     - Where the element is visually drawn on the canvas (in CSS pixels), vs.
     - What `element.getBoundingClientRect()` returns, vs.
     - What `document.elementFromPoint(visualX, visualY)` returns.
2. **Render a Temporary Neon Debug Overlay Over a Screenshot**:
   - Drawing `2px solid` colored boxes at `getBoundingClientRect()` for the card, heading, and buttons on top of the WebGL canvas and taking a screenshot (`Page.captureScreenshot`) immediately reveals any scale, DPR (`0.5×`), or origin offset in a single glance.

### C. Better Instrumentation in Chrome DevTools / Chromium for HTML-in-Canvas
1. **Console Warning When Calling Unimplemented `updateElementGeometry` / `clearElementGeometry` Stubs**:
   - In Chrome 155, `canvas.updateElementGeometry()` silently returns `undefined` without updating hit-test geometry. Emitting a one-time DevTools console warning (e.g., `"HTMLCanvasElement.updateElementGeometry is not active in this build; use style.transform or enable the updated CanvasDrawElement flag"`) would have saved an entire debugging cycle.
2. **DevTools "Show HTML-in-Canvas Hit-Test Quads" Overlay**:
   - Because `<canvas content="drawable">` / `<canvas layoutsubtree>` suppresses the direct visual painting of its children (so they are only visible where the author draws them in WebGL/2D), the live DOM hit-test boxes are **invisible** by default.
   - Adding a Chrome DevTools rendering toggle (or `DOM.getBoxModel` / `Overlay.highlightNode` support that visualizes the post-`updateElementGeometry` / post-`canvasTransform` hit-testing quad in a distinct color) would make mismatches between WebGL UV drawing and DOM hit-test transforms immediately obvious.
3. **Explicit Coordinate-Space Option or Inspection Getter on `HTMLCanvasElement`**:
   - Providing a read-only diagnostic method such as `canvas.getElementHitTestRect(element)` (returning the effective hit-test quad in CSS pixels relative to the canvas border box) in the HTML-in-Canvas API or CDP `DOM` domain would allow automated tests and developers to verify hit-test alignment directly.
