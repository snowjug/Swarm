/**
 * Pages built like the ones people read, with their menus, notices and footers around the text.
 * They are written here, not copied from any site; each has the kinds of markup that kind of page
 * has, and the text that is not the page's own is easy to spot.
 */

/** An encyclopedia article: site header, contents, language links, side panel, citation markers, edit links, lists of references and categories. */
export const ENCYCLOPEDIA_PAGE = `<!doctype html><html lang="en"><head><title>Congestion zone - Open Encyclopedia</title>
<meta name="description" content="A congestion zone is an area where drivers pay a charge to enter."></head>
<body class="skin-modern ns-0">
<a class="mw-jump-link" href="#content">Jump to content</a>
<header class="site-header"><a href="/">Open Encyclopedia</a>
  <nav aria-label="Site"><ul><li><a href="/">Main page</a></li><li><a href="/random">Random article</a></li><li><a href="/donate">Donate</a></li></ul></nav>
  <form role="search"><label for="q">Search the encyclopedia</label><input id="q" name="q"></form>
</header>
<nav class="toc" aria-label="Contents"><h2>Contents</h2><ul><li>1 History</li><li>2 Effects</li><li>3 See also</li></ul></nav>
<main id="content" class="page-body">
  <header class="page-title"><h1>Congestion zone</h1>
    <div class="mw-portlet mw-portlet-lang"><ul><li class="interlanguage-link"><a href="/de">Deutsch</a></li><li class="interlanguage-link"><a href="/fr">Fran\u00e7ais</a></li></ul><span>Edit links</span></div>
  </header>
  <div class="hatnote" role="note">For the legal term, see Zoning.</div>
  <table class="sidebar nomobile"><tr><th>Part of a series on</th></tr><tr><td>Economics Taxation Transport</td></tr></table>
  <p>A <b>congestion zone</b> is an area of a city where drivers pay a charge to enter, or to drive within it, during busy hours. The charge is meant to cut traffic and to pay for public transport.<sup id="cite_ref-a" class="reference"><a href="#cite_note-a">[1]</a></sup> The first scheme began in 1975<sup class="reference"><a href="#cite_note-b">[2]</a></sup><sup class="noprint Inline-Template">[<i>citation needed</i>]</sup>.</p>
  <h2><span id="History">History</span><span class="mw-editsection"><span class="mw-editsection-bracket">[</span><a href="/edit?section=1">edit</a><span class="mw-editsection-bracket">]</span></span></h2>
  <p>Cities that have tried the charge report fewer cars in the zone and more bus passengers, though shops in the zone and some drivers have objected to the cost.</p>
  <table class="infobox"><tr><th colspan="2">Congestion zone</th></tr><tr><th>First scheme</th><td>1975</td></tr><tr><th>Typical charge</th><td>5 to 15 euros a day</td></tr></table>
  <h2>See also</h2>
  <ul><li>Road pricing</li><li>Low-emission zone</li></ul>
  <h2>References</h2>
  <ol class="references"><li>Smith, J. (2001). A study of charges.</li><li>Lopez, M. (2010). Cities and cars.</li></ol>
  <div class="navbox" role="navigation"><table><tr><th>Transport</th><td>Roads Rail Buses Trams</td></tr></table></div>
  <div id="catlinks" class="catlinks"><a href="/cat">Categories</a>: Road pricing | Urban planning</div>
  <div class="printfooter">Retrieved from "https://example.org/wiki/Congestion_zone"</div>
</main>
<footer id="footer"><ul><li>This page was last edited on 1 May 2026.</li><li><a href="/privacy">Privacy policy</a></li></ul></footer>
</body></html>`;

/** A government service start page: skip link, cookie notice, banner, phase banner, breadcrumbs, a share box, related links and a footer. */
export const SERVICE_PAGE = `<!doctype html><html lang="en"><head><title>Renew your parking permit - Example Council</title>
<meta name="description" content="Renew a resident parking permit online."></head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<div id="cookie-banner" class="cookie-banner" role="region" aria-label="Cookies on Example Council"><h2>Cookies on Example Council</h2><p>We use some essential cookies to make this service work.</p><button>Accept cookies</button><a href="/cookies">View cookies</a></div>
<header role="banner" class="council-header"><a href="/">Example Council</a>
  <nav aria-label="Main menu"><ul><li><a href="/services">Services</a></li><li><a href="/contact">Contact us</a></li></ul></nav></header>
<div class="phase-banner"><strong>Beta</strong> This is a new service. Your feedback will help us to improve it.</div>
<div class="breadcrumbs"><ol><li><a href="/">Home</a></li><li><a href="/parking">Parking</a></li></ol></div>
<main id="main" role="main">
  <h1>Renew your parking permit</h1>
  <p>Use this service to renew a resident parking permit for your car. You can renew up to 28 days before your permit runs out.</p>
  <p>It takes about 5 minutes. You will need:</p>
  <ul><li>your vehicle registration number</li><li>proof of address dated within the last 3 months</li><li>a debit or credit card</li></ul>
  <h2>How much it costs</h2>
  <table><caption>Permit fees for 12 months</caption><tr><th>Engine size</th><th>Fee</th></tr><tr><td>Up to 1000cc</td><td>\u00a360</td></tr><tr><td>Over 1000cc</td><td>\u00a3120</td></tr></table>
  <h2>If you cannot use the service online</h2>
  <p>Call 0300 000 0000, Monday to Friday, 8am to 6pm. Calls cost the same as a local call.</p>
  <p><a class="start-button" role="button" href="/start">Start now</a></p>
  <div class="share">Share this page: <a href="/email">Email</a> <a href="/print">Print</a></div>
  <aside class="related-content"><h2>Related services</h2><ul><li><a href="/badge">Apply for a blue badge</a></li></ul></aside>
</main>
<footer role="contentinfo"><ul><li><a href="/accessibility">Accessibility</a></li><li><a href="/privacy">Privacy</a></li></ul><p>\u00a9 Example Council 2026</p></footer>
</body></html>`;

/** A news story: advert, masthead, sign-up pop-up, then an article with its own header, a pull quote, share links, a newsletter box and a footer, and a most-read panel. */
export const NEWS_PAGE = `<!doctype html><html lang="en"><head><title>Council approves charge for central zone | The Daily Example</title>
<meta name="description" content="Councillors voted 9 to 6 for a daily charge."></head>
<body>
<div class="advert" id="ad-top">Advertisement</div>
<header class="masthead"><a href="/">The Daily Example</a><nav><ul><li>World</li><li>Politics</li><li>Business</li><li>Sport</li></ul></nav><a href="/signin">Sign in</a></header>
<div class="popup newsletter-popup"><p>Get the morning briefing</p><form><input type="email" placeholder="Email"><button>Sign up</button></form></div>
<main>
  <article>
    <header><h1>Council approves charge for central zone</h1><p class="byline">By Jo Reporter, Transport correspondent</p><time datetime="2026-03-12">12 March 2026</time></header>
    <figure><img src="zone.jpg" alt="Traffic"><figcaption>Traffic in the central zone on a weekday morning.</figcaption></figure>
    <p>City councillors voted 9 to 6 on Tuesday to introduce a daily charge for drivers who enter the central zone, ending a debate that has lasted two years.</p>
    <p>Shop owners said the charge would hurt trade. Bus operators said they would add routes if the money arrives as promised, and residents' groups asked for the first year to be reviewed.</p>
    <aside class="pullquote"><p>"This will change how people travel."</p></aside>
    <blockquote>"We will publish the figures every quarter," the mayor said.</blockquote>
    <div class="share social"><span>Share on</span><a href="/x">X</a><a href="/f">Facebook</a></div>
    <section class="related"><h2>More on this story</h2><ul><li><a href="/a">Opinion: why the charge is right</a></li></ul></section>
    <div class="newsletter"><h3>Get our newsletter</h3><form><input type="email"><button>Subscribe</button></form></div>
    <footer class="article-footer">Tags: transport, charges, councils</footer>
  </article>
  <div id="comments" class="comments"><h2>Comments</h2><p>No comments yet.</p></div>
</main>
<aside class="sidebar"><h2>Most read</h2><ol><li>Another story</li></ol></aside>
<footer><p>\u00a9 The Daily Example</p><ul><li>Terms</li><li>Privacy</li></ul></footer>
</body></html>`;

/** A product page: announcement bar, header with a search form, filters, breadcrumbs, a buy form, description, specifications, reviews, a sign-up box and a footer. */
export const SHOP_PAGE = `<!doctype html><html lang="en"><head><title>Trail Runner 2 shoes | Example Shop</title>
<meta name="description" content="Light trail running shoes with a grippy sole.">
<script type="application/ld+json">{"@type":"Product","name":"Trail Runner 2","offers":{"price":"89.00","priceCurrency":"GBP"}}</script></head>
<body>
<div class="announcement-bar">Free delivery on orders over \u00a350</div>
<header class="header"><a href="/">Example Shop</a><nav><ul><li>Men</li><li>Women</li><li>Sale</li></ul></nav><form role="search"><input name="q" placeholder="Search"><button>Go</button></form><a href="/cart">Cart (0)</a></header>
<aside class="filters" aria-label="Filters"><h2>Filters</h2><fieldset><legend>Brand</legend><label><input type="checkbox"> Acme (12)</label><label><input type="checkbox"> Peak (7)</label></fieldset></aside>
<main>
  <nav class="breadcrumb" aria-label="Breadcrumb"><ol><li>Home</li><li>Shoes</li><li>Trail Runner 2</li></ol></nav>
  <h1>Trail Runner 2 shoes</h1>
  <p class="price">\u00a389.00</p>
  <p class="stock">In stock: ships in 2 days</p>
  <form class="buy"><label>Size</label><select><option>8</option><option>9</option></select><button>Add to basket</button></form>
  <h2>Description</h2>
  <p>A light shoe for rough ground. The sole grips wet rock and loose soil, and the upper dries quickly after a river crossing. It is made with recycled materials.</p>
  <ul><li>Weight: 280 g</li><li>Drop: 6 mm</li><li>Upper: recycled mesh</li></ul>
  <h2>Reviews</h2>
  <div class="review"><p><strong>Great grip</strong></p><p>Held on wet rocks all weekend. Runs half a size small. \u2014 Alex, 5 stars</p></div>
  <div class="review"><p><strong>Comfortable but pricey</strong></p><p>Light and cool, though I wish it cost less. \u2014 Sam, 4 stars</p></div>
  <div class="newsletter"><h2>Join our list</h2><p>Get 10% off your first order.</p><form><input type="email"><button>Subscribe</button></form></div>
  <section class="related-products"><h2>You may also like</h2><ul><li>Trail Socks \u00a312</li></ul></section>
</main>
<footer><ul><li>Delivery</li><li>Returns</li><li>Contact</li></ul><p>\u00a9 Example Shop</p></footer>
</body></html>`;
