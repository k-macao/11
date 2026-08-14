import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFinanceReport,
  parseRssItems,
  quoteFromChart,
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

  it('renders only financial content in markdown', () => {
    const report = buildFinanceReport({
      generatedAt: new Date('2026-08-14T08:00:00Z'),
      quotes: [{ label: '黄金', price: 2500, changePercent: -0.5, currency: 'USD' }],
      headlines: [{ title: '市场新闻', link: 'https://example.com', source: '财经社' }],
    });
    assert.match(report, /金融市场速报/);
    assert.match(report, /\| 黄金 \| 2,500 USD \| 🔻 -0\.50% \|/);
    assert.match(report, /\[市场新闻\]\(https:\/\/example\.com\)/);
    assert.doesNotMatch(report, /军事|气候|航空/);
  });
});
