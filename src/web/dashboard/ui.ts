export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <meta name="theme-color" content="#16131c">
    <title>TomoriBot Control Room</title>
    <link rel="icon" href="/settings/assets/tomori_companion_logo.svg">
    <link rel="stylesheet" href="/settings/assets/app.css">
    <link rel="stylesheet" href="/settings/assets/companion.css">
  </head>
  <body data-palette="tomori" data-theme="dark" data-motion="subtle" data-halftone="on">
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
    <div id="app" class="app-shell" aria-live="polite">
      <div class="boot-screen">
        <img src="/settings/assets/tomori_companion_logo.svg" alt="TomoriBot" class="boot-logo">
        <div class="boot-line"></div>
      </div>
    </div>
    <div id="toast-region" class="toast-region" aria-live="assertive" aria-atomic="true"></div>
    <script src="/settings/assets/app.js" defer></script>
  </body>
</html>`;
}
