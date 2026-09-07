<?php

declare(strict_types=1);

// Mounts the Vue app shell (frontend.md § Integration Model). Vue Router
// (src/router/index.ts) owns client-side routing from here — every page
// route in appinfo/routes.php renders this same template. `script()` is
// Nextcloud's template global that resolves to the built js/momentum-main.js
// bundle (glue-app/vite.config.ts). No separate `style()` call: the bundle
// is built as an IIFE (output.format: 'iife', required so its top-level
// bindings don't leak into the classic <script> tag's shared page scope —
// confirmed live, 2026-07-27), and Vite injects IIFE-bundled CSS via a
// runtime <style> tag rather than emitting a separate css/momentum-main.css
// file — a style() call here would just 404 on a file that no longer
// exists.
//
// No wrapping `<div id="content">` either: core's own layout.user.php already
// emits `<div id="content" class="app-momentum">` around whatever an app
// template renders (core/templates/layout.user.php in nextcloud/server), so
// wrapping again put two elements with the same id on the page. Core CSS
// positions the app shell by `#content`, and `@nextcloud/vue`'s NcContent
// renders into that grid — the duplicate made the inner one an unpositioned
// child of the outer, so the whole shell laid out wrong. An app template's
// job is the mount point alone; the chrome around it belongs to core.

/** @var \OCP\IL10N $l */

script('momentum', 'momentum-main');

?>
<div id="momentum-app"></div>
