import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFinanceReport,
  buildFinanceSummary,
  buildPreviewDocument,
  FINANCE_SYMBOLS,
  parseRssItems,
  quoteFromChart,
  sendToPushPlus,
} from '../scripts/push-finance-brief.mjs';

describe('PushPlus finance brief', () => {
  it('parses and decodes finance RSS items', () => {
    const items = parseRssItems(`
      <rss><channel><item>
        <title><![CDATA[央行 &amp; 市场动态]]></title>
        <link>https://example.com/story?a=1&amp;b=2</link>
        <source>示例财经</source>
        <pubDate>Fri, 14 Aug 2026 08:00:00 GMT</pubDate>
      </item></channel></rss>
    `);
    assert.deepEqual(items, [{
      title: '央行 & 市场动态',
      link: 'https://example.com/story?a=1&b=2',
      source: '示例财经',
      publishedAt: 'Fri, 14 Aug 2026 08:00:00 GMT',
    }]);
  });

  it('calculates quote movement from Yahoo chart metadata', () => {
    const quote = quoteFromChart('标普 500', {
      chart: { result: [{ meta: {
        regularMarketPrice: 5100,
        chartPreviousClose: 5000,
        currency: 'USD',
        regularMarketTime: 1_786_694_400,
      } }] },
    });
    assert.equal(quote.label, '标普 500');
    assert.equal(quote.changePercent, 2);
  });

  it('renders a portrait editorial issue instead of a markdown table', () => {
    const report = buildFinanceReport({
      generatedAt: new Date('2026-08-14T08:00:00Z'),
      quotes: [{ label: '黄金', price: 2500, changePercent: -0.5, currency: 'USD' }],
      headlines: [{
        title: '市场新闻 & <观察>',
        link: 'https://example.com/story?a=1&b=2',
        source: '财经社',
        publishedAt: 'Fri, 14 Aug 2026 08:00:00 GMT',
      }],
    });

    assert.match(report, /data-finance-template="editorial-portrait"/);
    assert.match(report, /aspect-ratio:3\/4/);
    assert.match(report, /WORLD MONITOR/);
    assert.match(report, /金融市场<br>纵览/);
    assert.match(report, /黄金/);
    assert.match(report, /2,500 USD/);
    assert.match(report, /▼ -0\.50%/);
    assert.match(report, /href="https:\/\/example\.com\/story\?a=1&amp;b=2"/);
    assert.match(report, /市场新闻 &amp; &lt;观察&gt;/);
    assert.doesNotMatch(report, /\| 黄金 \|/);
    assert.doesNotMatch(report, /📈|🔺|🔻/);
    assert.doesNotMatch(report, /军事|气候|航空/);
  });

  it('keeps the maximum manual-run issue below the PushPlus 100,000-character member limit', () => {
    const quotes = FINANCE_SYMBOLS.map(([, label], index) => ({
      label,
      price: 12_345.678 + index,
      changePercent: (index - 5.5) / 2,
      currency: 'USD',
    }));
    const headlines = Array.from({ length: 15 }, (_, index) => ({
      title: `第 ${index + 1} 条用于验证内容上限的金融市场标题：${'央行、汇率与全球资产重新定价。'.repeat(12)}`,
      link: `https://example.com/finance/${index + 1}?payload=${'x'.repeat(1_000)}`,
      source: 'World Monitor Financial News Desk '.repeat(8),
      publishedAt: '2026-08-14T08:00:00Z',
    }));
    const report = buildFinanceReport({
      generatedAt: new Date('2026-08-14T08:00:00Z'),
      quotes,
      headlines,
    });
    assert.ok(report.length <= 100_000, `maximum report is ${report.length} characters`);
  });

  it('does not emit unsafe headline links into the HTML issue', () => {
    const report = buildFinanceReport({
      generatedAt: new Date('2026-08-14T08:00:00Z'),
      quotes: [],
      headlines: [{ title: '<script>alert(1)</script>', link: 'javascript:alert(1)', source: 'bad' }],
    });
    assert.match(report, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(report, /href="javascript:/);
    assert.doesNotMatch(report, /<script>/);
  });

  it('keeps a compact markdown version for the Actions run summary', () => {
    const summary = buildFinanceSummary({
      generatedAt: new Date('2026-08-14T08:00:00Z'),
      quotes: [{ label: '黄金', price: 2500, changePercent: -0.5, currency: 'USD' }],
      headlines: [{ title: '市场新闻', link: 'https://example.com', source: '财经社' }],
    });
    assert.match(summary, /\| 黄金 \| 2,500 USD \| ▼ -0\.50% \|/);
    assert.match(summary, /\[市场新闻\]\(https:\/\/example\.com\)/);
  });

  it('wraps the PushPlus fragment in a standalone local preview document', () => {
    const preview = buildPreviewDocument('<div>issue</div>');
    assert.match(preview, /^<!doctype html>/);
    assert.match(preview, /<meta name="viewport"/);
    assert.match(preview, /<div>issue<\/div>/);
  });

  it('rejects oversized HTML before calling PushPlus', async () => {
    await assert.rejects(
      sendToPushPlus({ token: 'test-token', title: 'too large', content: 'x'.repeat(100_001) }),
      /超过 100000 字限制/,
    );
  });

  it('sends the redesigned issue through the PushPlus HTML template', async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ code: 200, msg: 'ok' }) };
    };

    try {
      await sendToPushPlus({
        token: 'test-token',
        title: '金融市场纵览',
        content: '<div>issue</div>',
        topic: 'markets',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://www.pushplus.plus/send');
    assert.equal(body.template, 'html');
    assert.equal(body.content, '<div>issue</div>');
    assert.equal(body.topic, 'markets');
  });
});
