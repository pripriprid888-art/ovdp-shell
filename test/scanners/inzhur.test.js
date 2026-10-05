const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  extractCatalogFromHtml,
  extractDomCatalogFromHtml,
  extractInzhurCatalogFromHtml,
  parseFlightCatalogRoot,
} = require('../../src/scanners/inzhur-catalog-parse');
const vm = require('vm');
const { EXTRACT_BONDS_JS, processRawItems } = require('../../src/scanners/inzhur');

describe('Inzhur catalog scrape', () => {
  it('parses embedded catalog payload from the public OVDP page', async () => {
    const tmpFile = path.join(os.tmpdir(), `inzhur-ovdp-${Date.now()}.html`);
    execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', 'https://www.inzhur.reit/offer/ovdp', '-o', tmpFile], {
      stdio: 'pipe',
    });
    const html = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);

    const rawItems = extractInzhurCatalogFromHtml(html);
    assert.ok(rawItems.length >= 13, `expected active catalog bonds, got ${rawItems.length}`);

    const domItems = extractDomCatalogFromHtml(html);
    assert.ok(domItems.length >= 13, `expected rendered desktop cards, got ${domItems.length}`);

    const sample = rawItems.find((item) => item.isin === 'UA4000239016')
      || rawItems.find((item) => item.isin === 'UA4000234223');
    assert.ok(sample, 'expected a known ISIN in catalog payload');
    assert.ok(sample.buy_price > 900, 'buy price should look like UAH quote');
    assert.ok(sample.available_count > 0, 'catalog bond should have available quantity');
    assert.ok(sample.asset_id, 'merged catalog should keep asset_id from embedded payload');

    const domSample = domItems.find((item) => item.isin === sample.isin);
    assert.ok(domSample?.buy_price, 'desktop card should include buy price');

    const proposals = processRawItems(rawItems);
    assert.ok(
      proposals.length >= domItems.length - 2,
      `expected ~${domItems.length} active catalog bonds, got ${proposals.length}`,
    );
    assert.ok(
      !proposals.some((item) => item.isin === 'UA4000228449'),
      'completed zero-qty bonds should not appear in catalog',
    );

    const proposal = proposals.find((item) => item.isin === sample.isin);
    assert.ok(proposal?.buy_price, 'processed proposal should include buy_price');
    assert.match(proposal.yield_percent || '', /%/);
    assert.equal(proposal.is_buyable, true);
  });

  it('drops completed and zero-quantity rows when processing catalog', () => {
    const proposals = processRawItems([
      {
        isin: 'UA4000228449',
        asset_id: '111',
        buy_price: 1091.15,
        available_count: 0,
        status: 'completed',
        has_invest_button: false,
        invest_button_disabled: true,
      },
      {
        isin: 'UA4000239016',
        asset_id: '222',
        buy_price: 1032.37,
        available_count: 2501,
        status: 'active',
        has_invest_button: true,
        invest_button_disabled: false,
      },
    ]);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].isin, 'UA4000239016');
  });

  it('keeps only bond rows from flight payload', () => {
    const root = ['Map'];
    root[1] = 'bond';
    root[2] = 'active';
    root[3] = {
      isin: 4,
      maturityDate: 5,
      prices: 6,
      availableQuantity: 7,
      returnRates: 8,
      paymentSchedule: 9,
      forecasts: 10,
    };
    root[4] = 'UA4000999999';
    root[5] = '2028-01-01T00:00:00.000Z';
    root[6] = { buyUAH: 11, sellUAH: 12 };
    root[7] = 100;
    root[8] = { buy: 13 };
    root[9] = 10;
    root[10] = 11;
    root[11] = 1001.5;
    root[12] = 999.5;
    root[13] = 14;
    root[14] = 12.3;
    root[15] = { id: 10, status: 2, type: 1, details: 3 };

    const items = parseFlightCatalogRoot(root);
    assert.equal(items.length, 1);
    assert.equal(items[0].isin, 'UA4000999999');
    assert.equal(items[0].buy_price, 1001.5);
  });

  it('runs the browser extract script without missing closure refs', async () => {
    const tmpFile = path.join(os.tmpdir(), `inzhur-ovdp-browser-${Date.now()}.html`);
    execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', 'https://www.inzhur.reit/offer/ovdp', '-o', tmpFile], {
      stdio: 'pipe',
    });
    const html = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);

    const document = {
      documentElement: { innerHTML: html },
      querySelectorAll: (selector) => {
        if (selector === 'script') {
          const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
          return scripts.map((tag) => ({
            textContent: tag.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''),
          }));
        }
        return [];
      },
      querySelector: () => null,
    };

    const rawItems = vm.runInNewContext(EXTRACT_BONDS_JS, { document });
    assert.ok(Array.isArray(rawItems));
    assert.ok(rawItems.length >= 13, `expected active catalog bonds, got ${rawItems.length}`);
    assert.ok(rawItems.every((item) => /^UA4000\d{6}$/.test(item.isin || '')));
    assert.ok(
      !rawItems.some((item) => item.isin === 'UA4000228449'),
      'browser extract should omit completed catalog rows',
    );
  });
});
