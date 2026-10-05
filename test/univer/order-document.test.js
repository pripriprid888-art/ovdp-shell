const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  looksLikeLoginHtml,
  extractPdfUrlsFromHtml,
  extractOrderPdfLinkFromHtml,
  extractOrderDocumentIdFromHtml,
  buildUniverDocumentPdfUrl,
  isUniverOrderDownloadable,
  isPdfBuffer,
  assertPdfBuffer,
} = require('../../src/univer/order-document');

const SAMPLE_ORDER_TABLE_HTML = `
  <div class="os-overflow-table" style="overflow: auto;">
    <table class="os-table">
      <thead>
        <tr>
          <td>#</td>
          <td>Номер документа</td>
          <td>Назва</td>
          <td>Сформований</td>
          <td></td>
        </tr>
      </thead>
      <tbody><tr>
        <td>732688</td>
        <td>732688</td>
        <td>Client_Order_Petrov_Rostyslav_Oleksandrovych_3642908475_3535991</td>
        <td>2026-08-28 20:17:06</td>
        <td><a href="/client/document/732688/pdf/?download=1" style="color: #0375c2;">Завантажити PDF</a></td>
      </tr></tbody>
    </table>
  </div>
`;

describe('Univer order PDF helpers', () => {
  it('extracts the download link from the order documents table', () => {
    const link = extractOrderPdfLinkFromHtml(SAMPLE_ORDER_TABLE_HTML, '3535991');
    assert.equal(link?.url, 'https://univer.1b.app/client/document/732688/pdf/?download=1');
    assert.match(link?.docName || '', /Client_Order_.*3535991/);
    assert.equal(link?.label, 'Завантажити PDF');
  });

  it('extracts document id and builds a direct pdf url', () => {
    assert.equal(extractOrderDocumentIdFromHtml(SAMPLE_ORDER_TABLE_HTML, '3535991'), '732688');
    assert.equal(
      buildUniverDocumentPdfUrl('732688'),
      'https://univer.1b.app/client/document/732688/pdf/?download=1',
    );
  });

  it('extracts document pdf urls from order html', () => {
    const html = `
      <a href="/client/document/765257/pdf/?download=1">Завантажити PDF</a>
      <a href="/client/document/765257/pdf/">Переглянути</a>
    `;
    const urls = extractPdfUrlsFromHtml(html);
    assert.equal(urls.length, 1);
    assert.equal(urls[0], 'https://univer.1b.app/client/document/765257/pdf/?download=1');
  });

  it('does not treat authorization wording on order pages as login', () => {
    const html = `
      <html><body>
        <div>Авторизація клієнта підтверджена</div>
        <a href="/client/login/">Вхід</a>
      </body></html>
    `;
    assert.equal(looksLikeLoginHtml(html), false);
  });

  it('validates pdf buffers', () => {
    assert.equal(isPdfBuffer(Buffer.from('%PDF-1.4')), true);
    assert.equal(isPdfBuffer(Buffer.from('<html>')), false);
    assert.doesNotThrow(() => assertPdfBuffer(Buffer.from('%PDF-1.4 test')));
    assert.throws(
      () => assertPdfBuffer(Buffer.from('<html><body>login</body></html>')),
      /UNIVER повернув сторінку замість PDF/,
    );
  });

  it('treats in-progress orders as downloadable', () => {
    assert.equal(isUniverOrderDownloadable('В роботі'), true);
    assert.equal(isUniverOrderDownloadable('  в роботі  '), true);
    assert.equal(isUniverOrderDownloadable('In progress'), true);
    assert.equal(isUniverOrderDownloadable('Очікує підтвердження'), false);
    assert.equal(isUniverOrderDownloadable('Скасовано'), false);
  });

  it('detects a real login form', () => {
    const html = `
      <form>
        <input name="login" type="text">
        <input name="password" type="password">
        <button>Увійти</button>
      </form>
    `;
    assert.equal(looksLikeLoginHtml(html), true);
  });
});
