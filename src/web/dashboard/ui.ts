import english from "@/locales/en-US/general";

const loadingTitle = english.general.dashboard.interface_entry_loading;

export function renderDashboardHtml(content?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="dark light">
    <meta name="theme-color" content="#16131c">
    <title>TomoriBot Control Room</title>
    <link rel="icon" href="/settings/assets/tomori_companion_logo.svg">
    <link rel="stylesheet" href="/settings/assets/ui-kit.css?v=3">
    <link rel="stylesheet" href="/settings/assets/dashboard.css?v=7">
    <link rel="stylesheet" href="/settings/assets/controls.css?v=3">
    <link rel="stylesheet" href="/settings/assets/collection.css">
  </head>
  <body data-palette="tomori" data-theme="dark" data-motion="full" data-surface="glass" data-color-mode="colorful" data-halftone="on" data-layout="boxed">
    ${content === undefined ? '<script src="/settings/assets/design.js"></script>' : ""}
    <div class="bg-field" aria-hidden="true">
      <div class="bg-halftone"></div>
      <div class="bg-halftone warm"></div>
      <div class="bg-stripes"></div>
      <div class="bg-corner-tag"></div>
      <div class="sparkles">
        <span class="spark">✦</span><span class="spark teal">✧</span><span class="spark pink">✦</span>
        <span class="spark">✧</span><span class="spark teal">✦</span><span class="spark pink">✧</span>
      </div>
      <div class="float-hearts">
        <span class="heart">♡</span><span class="heart teal">✦</span><span class="heart gold">♡</span>
        <span class="heart">✧</span><span class="heart teal">♡</span>
      </div>
    </div>
    <div id="app" class="app-shell">
      ${
        content ??
        `<main class="app-main" data-dashboard-entry="loading" aria-busy="true">
        <div class="stack" data-entry-layout>
          <section class="banner compact" aria-labelledby="entry-title">
            <div class="banner-info"><div class="stack">
              <p class="crumb">TomoriBot Control</p>
              <h1 id="entry-title">${loadingTitle}</h1>
              <div class="loading" role="progressbar" aria-labelledby="entry-title"></div>
            </div></div>
            <div class="banner-art" aria-hidden="true"><span class="sticker emblem"><img src="/settings/assets/tomori_companion_logo.svg" alt=""></span></div>
          </section>
        </div>
      </main>`
      }
    </div>
    <div id="toast-region" class="toasts" role="status"></div>
    <script src="/settings/assets/controls.js" defer></script>
    <script src="/settings/assets/fx.js" defer></script>
    ${content === undefined ? '<script src="/settings/assets/site.js" defer></script>' : ""}
    ${content === undefined ? '<script src="/settings/assets/app.js?v=2" defer></script>' : ""}
  </body>
</html>`;
}
