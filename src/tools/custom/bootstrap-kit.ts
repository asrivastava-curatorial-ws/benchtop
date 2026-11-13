/**
 * Static HTML showing most Bootstrap components, used to preview themes.
 * Interactive parts (dropdowns, accordions, modals, toasts) are shown in their
 * open state because previews never run scripts.
 */

const VARIANTS = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'] as const;

const buttons = VARIANTS.map((v) => `<button type="button" class="btn btn-${v}">${v[0]?.toUpperCase()}${v.slice(1)}</button>`).join('\n');
const outlines = VARIANTS.map((v) => `<button type="button" class="btn btn-outline-${v}">${v[0]?.toUpperCase()}${v.slice(1)}</button>`).join('\n');
const swatches = VARIANTS.map(
  (v) => `<div class="col"><div class="p-3 rounded text-bg-${v}">${v}</div><div class="p-2 mt-1 rounded bg-${v}-subtle text-${v}-emphasis border border-${v}-subtle small">${v} subtle</div></div>`,
).join('\n');
const badges = VARIANTS.map((v) => `<span class="badge text-bg-${v}">${v}</span>`).join('\n');

const COMPONENTS = `
<nav class="navbar navbar-expand-sm bg-body-tertiary border-bottom">
  <div class="container-fluid">
    <a class="navbar-brand fw-semibold" href="#top">Workbench</a>
    <div class="collapse navbar-collapse show">
      <ul class="navbar-nav me-auto mb-2 mb-lg-0">
        <li class="nav-item"><a class="nav-link active" aria-current="page" href="#buttons">Buttons</a></li>
        <li class="nav-item"><a class="nav-link" href="#forms">Forms</a></li>
        <li class="nav-item"><a class="nav-link" href="#cards">Cards</a></li>
        <li class="nav-item"><a class="nav-link disabled" aria-disabled="true">Disabled</a></li>
      </ul>
      <form class="d-flex" role="search">
        <input class="form-control me-2" type="search" placeholder="Search parts" aria-label="Search">
        <button class="btn btn-outline-primary" type="button">Search</button>
      </form>
    </div>
  </div>
</nav>

<main class="container py-4" id="top">
  <section class="mb-5">
    <h1 class="display-5 fw-bold">Theme preview</h1>
    <p class="lead">Every change you make is compiled with Bootstrap's own Sass and shown here.</p>
    <p>Body text with <a href="#top">a link</a>, <strong>bold</strong>, <em>italic</em>, <mark>highlighted</mark>, <small>small</small> and <code>inline code</code>. Press <kbd>Ctrl</kbd> + <kbd>S</kbd> to save.</p>
    <div class="row g-4">
      <div class="col-md-6">
        <h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><h4>Heading 4</h4><h5>Heading 5</h5><h6>Heading 6</h6>
      </div>
      <div class="col-md-6">
        <figure>
          <blockquote class="blockquote"><p>Measure twice, cut once.</p></blockquote>
          <figcaption class="blockquote-footer">Workshop saying</figcaption>
        </figure>
        <ul><li>Unordered list item</li><li>Another item<ul><li>Nested item</li></ul></li></ul>
        <ol><li>First step</li><li>Second step</li></ol>
        <p class="text-body-secondary">Secondary text</p>
        <p class="text-body-tertiary">Tertiary text</p>
      </div>
    </div>
  </section>

  <section class="mb-5" id="colors">
    <h2 class="h3 mb-3">Colours</h2>
    <div class="row row-cols-2 row-cols-md-4 g-3">${swatches}</div>
  </section>

  <section class="mb-5" id="buttons">
    <h2 class="h3 mb-3">Buttons</h2>
    <div class="d-flex flex-wrap gap-2 mb-3">${buttons}
<button type="button" class="btn btn-link">Link</button></div>
    <div class="d-flex flex-wrap gap-2 mb-3">${outlines}</div>
    <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
      <button type="button" class="btn btn-primary btn-lg">Large</button>
      <button type="button" class="btn btn-primary">Default</button>
      <button type="button" class="btn btn-primary btn-sm">Small</button>
      <button type="button" class="btn btn-primary" disabled>Disabled</button>
      <div class="btn-group" role="group" aria-label="Alignment">
        <button type="button" class="btn btn-outline-secondary active">Left</button>
        <button type="button" class="btn btn-outline-secondary">Middle</button>
        <button type="button" class="btn btn-outline-secondary">Right</button>
      </div>
      <button type="button" class="btn btn-primary position-relative">Inbox <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">9</span></button>
    </div>
    <div class="d-flex flex-wrap gap-2">${badges}
<span class="badge rounded-pill text-bg-primary">Pill</span></div>
  </section>

  <section class="mb-5" id="alerts">
    <h2 class="h3 mb-3">Alerts</h2>
    <div class="alert alert-primary" role="alert">A primary alert with <a href="#alerts" class="alert-link">a link</a>.</div>
    <div class="alert alert-success" role="alert"><h4 class="alert-heading h5">Saved</h4>Your settings were saved.</div>
    <div class="alert alert-warning alert-dismissible" role="alert">Check the voltage before connecting. <button type="button" class="btn-close" aria-label="Close"></button></div>
    <div class="alert alert-danger mb-0" role="alert">The part number does not exist.</div>
  </section>

  <section class="mb-5" id="cards">
    <h2 class="h3 mb-3">Cards</h2>
    <div class="row row-cols-1 row-cols-md-3 g-4">
      <div class="col"><div class="card h-100">
        <div class="card-header">Featured</div>
        <div class="card-body"><h5 class="card-title">Bench vice</h5><p class="card-text">Cast iron jaws, 150 mm opening, swivel base.</p><a href="#cards" class="btn btn-primary">Order</a></div>
        <div class="card-footer text-body-secondary">In stock</div>
      </div></div>
      <div class="col"><div class="card h-100">
        <div class="card-body"><h5 class="card-title">Sensors</h5><h6 class="card-subtitle mb-2 text-body-secondary">This week</h6></div>
        <ul class="list-group list-group-flush"><li class="list-group-item">Temperature</li><li class="list-group-item">Humidity</li><li class="list-group-item">Air quality</li></ul>
        <div class="card-body"><a href="#cards" class="card-link">Details</a><a href="#cards" class="card-link">Export</a></div>
      </div></div>
      <div class="col"><div class="card text-bg-primary h-100">
        <div class="card-body"><h5 class="card-title">Visitors today</h5><p class="display-6 mb-0">1,248</p><p class="card-text">Up 12% on last week.</p></div>
      </div></div>
    </div>
  </section>

  <section class="mb-5" id="forms">
    <h2 class="h3 mb-3">Forms</h2>
    <form class="row g-3">
      <div class="col-md-6"><label for="f-email" class="form-label">Email</label><input type="email" class="form-control" id="f-email" placeholder="name@example.org"><div class="form-text">We never share it.</div></div>
      <div class="col-md-6"><label for="f-password" class="form-label">Password</label><input type="password" class="form-control" id="f-password" value="secret"></div>
      <div class="col-md-4"><label for="f-select" class="form-label">Material</label><select id="f-select" class="form-select"><option>Oak</option><option>Steel</option><option>Acrylic</option></select></div>
      <div class="col-md-4"><label for="f-group" class="form-label">Price</label><div class="input-group"><span class="input-group-text">₹</span><input id="f-group" type="text" class="form-control" value="1200"><span class="input-group-text">.00</span></div></div>
      <div class="col-md-4"><div class="form-floating"><input type="text" class="form-control" id="f-floating" placeholder="Name"><label for="f-floating">Floating label</label></div></div>
      <div class="col-md-6"><label for="f-valid" class="form-label">Valid field</label><input type="text" class="form-control is-valid" id="f-valid" value="Looks right"><div class="valid-feedback">Looks right.</div></div>
      <div class="col-md-6"><label for="f-invalid" class="form-label">Invalid field</label><input type="text" class="form-control is-invalid" id="f-invalid" value="12ab"><div class="invalid-feedback">Enter numbers only.</div></div>
      <div class="col-12"><label for="f-notes" class="form-label">Notes</label><textarea class="form-control" id="f-notes" rows="2"></textarea></div>
      <div class="col-md-4">
        <div class="form-check"><input class="form-check-input" type="checkbox" id="f-check1" checked><label class="form-check-label" for="f-check1">Checked</label></div>
        <div class="form-check"><input class="form-check-input" type="checkbox" id="f-check2"><label class="form-check-label" for="f-check2">Unchecked</label></div>
        <div class="form-check"><input class="form-check-input" type="checkbox" id="f-check3" disabled><label class="form-check-label" for="f-check3">Disabled</label></div>
      </div>
      <div class="col-md-4">
        <div class="form-check"><input class="form-check-input" type="radio" name="f-radio" id="f-radio1" checked><label class="form-check-label" for="f-radio1">Option one</label></div>
        <div class="form-check"><input class="form-check-input" type="radio" name="f-radio" id="f-radio2"><label class="form-check-label" for="f-radio2">Option two</label></div>
        <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="f-switch" checked><label class="form-check-label" for="f-switch">Switch</label></div>
      </div>
      <div class="col-md-4"><label for="f-range" class="form-label">Range</label><input type="range" class="form-range" id="f-range"></div>
      <div class="col-12 d-flex gap-2"><button type="button" class="btn btn-primary">Submit</button><button type="button" class="btn btn-outline-secondary">Cancel</button></div>
    </form>
  </section>

  <section class="mb-5" id="tables">
    <h2 class="h3 mb-3">Tables</h2>
    <table class="table table-striped table-hover align-middle">
      <thead><tr><th scope="col">#</th><th scope="col">Exhibit</th><th scope="col">Gallery</th><th scope="col">Status</th></tr></thead>
      <tbody>
        <tr><th scope="row">1</th><td>Steam engine</td><td>Engineering hall</td><td><span class="badge text-bg-success">Open</span></td></tr>
        <tr><th scope="row">2</th><td>Pendulum</td><td>Physics</td><td><span class="badge text-bg-warning">Maintenance</span></td></tr>
        <tr class="table-active"><th scope="row">3</th><td>Planetarium dome</td><td>Space</td><td><span class="badge text-bg-secondary">Closed</span></td></tr>
      </tbody>
    </table>
  </section>

  <section class="mb-5" id="navigation">
    <h2 class="h3 mb-3">Navigation</h2>
    <ul class="nav nav-tabs mb-3"><li class="nav-item"><a class="nav-link active" href="#navigation">Active</a></li><li class="nav-item"><a class="nav-link" href="#navigation">Link</a></li><li class="nav-item"><a class="nav-link disabled" aria-disabled="true">Disabled</a></li></ul>
    <ul class="nav nav-pills mb-3"><li class="nav-item"><a class="nav-link active" href="#navigation">Active</a></li><li class="nav-item"><a class="nav-link" href="#navigation">Link</a></li><li class="nav-item"><a class="nav-link" href="#navigation">Another</a></li></ul>
    <ul class="nav nav-underline mb-3"><li class="nav-item"><a class="nav-link active" href="#navigation">Overview</a></li><li class="nav-item"><a class="nav-link" href="#navigation">Specs</a></li><li class="nav-item"><a class="nav-link" href="#navigation">Reviews</a></li></ul>
    <nav aria-label="breadcrumb"><ol class="breadcrumb"><li class="breadcrumb-item"><a href="#navigation">Home</a></li><li class="breadcrumb-item"><a href="#navigation">Tools</a></li><li class="breadcrumb-item active" aria-current="page">Theme</li></ol></nav>
    <nav aria-label="Pages"><ul class="pagination"><li class="page-item disabled"><a class="page-link">Previous</a></li><li class="page-item"><a class="page-link" href="#navigation">1</a></li><li class="page-item active" aria-current="page"><a class="page-link" href="#navigation">2</a></li><li class="page-item"><a class="page-link" href="#navigation">3</a></li><li class="page-item"><a class="page-link" href="#navigation">Next</a></li></ul></nav>
  </section>

  <section class="mb-5" id="lists">
    <h2 class="h3 mb-3">List group and progress</h2>
    <div class="row g-4">
      <div class="col-md-6"><div class="list-group">
        <a href="#lists" class="list-group-item list-group-item-action active" aria-current="true">Selected item</a>
        <a href="#lists" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">With a badge <span class="badge text-bg-primary rounded-pill">14</span></a>
        <a href="#lists" class="list-group-item list-group-item-action list-group-item-success">Success item</a>
        <a class="list-group-item list-group-item-action disabled" aria-disabled="true">Disabled item</a>
      </div></div>
      <div class="col-md-6">
        <div class="progress mb-3" role="progressbar" aria-label="Progress" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width: 40%">40%</div></div>
        <div class="progress mb-3" role="progressbar" aria-label="Striped" aria-valuenow="65" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar progress-bar-striped bg-success" style="width: 65%"></div></div>
        <div class="progress-stacked mb-3"><div class="progress" role="progressbar" aria-label="Part one" style="width: 20%"><div class="progress-bar bg-info"></div></div><div class="progress" role="progressbar" aria-label="Part two" style="width: 30%"><div class="progress-bar bg-warning"></div></div><div class="progress" role="progressbar" aria-label="Part three" style="width: 15%"><div class="progress-bar bg-danger"></div></div></div>
        <div class="d-flex gap-3 align-items-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading</span></div><div class="spinner-grow text-secondary" role="status"><span class="visually-hidden">Loading</span></div><div class="spinner-border spinner-border-sm text-success" role="status"><span class="visually-hidden">Loading</span></div></div>
      </div>
    </div>
  </section>

  <section class="mb-5" id="overlays">
    <h2 class="h3 mb-3">Accordion, dropdown, toast and modal</h2>
    <div class="row g-4">
      <div class="col-md-6">
        <div class="accordion" id="acc">
          <div class="accordion-item"><h3 class="accordion-header"><button class="accordion-button" type="button">Opening hours</button></h3><div class="accordion-collapse collapse show"><div class="accordion-body">Open every day except Mondays, 9:30 to 18:00.</div></div></div>
          <div class="accordion-item"><h3 class="accordion-header"><button class="accordion-button collapsed" type="button">Tickets</button></h3></div>
          <div class="accordion-item"><h3 class="accordion-header"><button class="accordion-button collapsed" type="button">Accessibility</button></h3></div>
        </div>
      </div>
      <div class="col-md-6 d-flex flex-wrap gap-4 align-items-start">
        <ul class="dropdown-menu show position-static"><li><h6 class="dropdown-header">Actions</h6></li><li><a class="dropdown-item active" href="#overlays">Edit</a></li><li><a class="dropdown-item" href="#overlays">Duplicate</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="#overlays">Delete</a></li></ul>
        <div class="toast show" role="status" aria-live="polite"><div class="toast-header"><strong class="me-auto">Benchtop</strong><small>just now</small><button type="button" class="btn-close" aria-label="Close"></button></div><div class="toast-body">Theme compiled successfully.</div></div>
      </div>
      <div class="col-12">
        <div class="modal position-static d-block" tabindex="-1"><div class="modal-dialog m-0"><div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">Discard changes?</h5><button type="button" class="btn-close" aria-label="Close"></button></div>
          <div class="modal-body"><p class="mb-0">Your edits to this theme have not been exported yet.</p></div>
          <div class="modal-footer"><button type="button" class="btn btn-secondary">Keep editing</button><button type="button" class="btn btn-danger">Discard</button></div>
        </div></div></div>
      </div>
    </div>
  </section>

  <section class="mb-5" id="utilities">
    <h2 class="h3 mb-3">Shadows, borders and radii</h2>
    <div class="row row-cols-2 row-cols-md-4 g-4 text-center">
      <div class="col"><div class="p-3 bg-body shadow-sm rounded">Small shadow</div></div>
      <div class="col"><div class="p-3 bg-body shadow rounded">Shadow</div></div>
      <div class="col"><div class="p-3 bg-body shadow-lg rounded">Large shadow</div></div>
      <div class="col"><div class="p-3 border border-2 border-primary rounded-3">Border</div></div>
      <div class="col"><div class="p-3 bg-body-secondary rounded-0">Square</div></div>
      <div class="col"><div class="p-3 bg-body-secondary rounded-2">Rounded</div></div>
      <div class="col"><div class="p-3 bg-body-secondary rounded-4">Rounded 4</div></div>
      <div class="col"><div class="p-3 bg-body-secondary rounded-pill">Pill</div></div>
    </div>
  </section>
</main>`;

const EXAMPLE = `
<header class="py-3 border-bottom bg-body-tertiary"><div class="container d-flex align-items-center gap-3"><span class="fs-5 fw-semibold me-auto">City Science Centre</span><a class="btn btn-outline-secondary btn-sm" href="#plan">Plan a visit</a><a class="btn btn-primary btn-sm" href="#plan">Buy tickets</a></div></header>
<main>
  <section class="py-5 text-center container">
    <h1 class="display-5 fw-bold">Hands-on science for everyone</h1>
    <p class="lead col-lg-8 mx-auto">Five galleries, a planetarium and a maker space, open every day except Mondays.</p>
    <div class="d-flex gap-2 justify-content-center"><a href="#plan" class="btn btn-primary btn-lg px-4">Book a visit</a><a href="#galleries" class="btn btn-outline-secondary btn-lg px-4">Explore galleries</a></div>
  </section>
  <section class="container pb-5" id="galleries">
    <div class="row row-cols-1 row-cols-md-3 g-4">
      <div class="col"><div class="card h-100 shadow-sm"><div class="card-body"><span class="badge text-bg-primary mb-2">New</span><h2 class="h5">Electricity</h2><p class="card-text text-body-secondary">Build circuits and light up a model city.</p></div></div></div>
      <div class="col"><div class="card h-100 shadow-sm"><div class="card-body"><span class="badge text-bg-success mb-2">Family</span><h2 class="h5">Fun science</h2><p class="card-text text-body-secondary">Mirrors, optical illusions and sound tubes.</p></div></div></div>
      <div class="col"><div class="card h-100 shadow-sm"><div class="card-body"><span class="badge text-bg-warning mb-2">Shows</span><h2 class="h5">Planetarium</h2><p class="card-text text-body-secondary">Daily sky shows in English and Kannada.</p></div></div></div>
    </div>
  </section>
  <section class="bg-body-secondary py-5" id="plan">
    <div class="container"><div class="row g-5 align-items-center">
      <div class="col-md-6"><h2>Plan your visit</h2><p>Groups of 20 or more get a guided tour. School bookings open two weeks in advance.</p><ul class="list-unstyled"><li>✓ Free entry for children under 3</li><li>✓ Wheelchairs available at the entrance</li><li>✓ Café and picnic area</li></ul></div>
      <div class="col-md-6"><form class="card card-body shadow-sm"><div class="mb-3"><label class="form-label" for="e-date">Date</label><input class="form-control" id="e-date" type="date"></div><div class="row g-2 mb-3"><div class="col"><label class="form-label" for="e-adults">Adults</label><input class="form-control" id="e-adults" type="number" value="2"></div><div class="col"><label class="form-label" for="e-children">Children</label><input class="form-control" id="e-children" type="number" value="1"></div></div><button class="btn btn-primary w-100" type="button">Check availability</button></form></div>
    </div></div>
  </section>
</main>
<footer class="container py-4 text-body-secondary small border-top">Example page for previewing a Bootstrap theme.</footer>`;

export type KitPage = 'components' | 'example';

export function previewDocument(css: string, mode: 'light' | 'dark', page: KitPage): string {
  // `</style` inside the CSS would end the element early; Bootstrap never contains it, but user Sass could.
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="en" data-bs-theme="${mode}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Theme preview</title>
<style>${safeCss}</style>
<style>html{scroll-behavior:auto}</style>
</head>
<body>${page === 'components' ? COMPONENTS : EXAMPLE}</body>
</html>`;
}
