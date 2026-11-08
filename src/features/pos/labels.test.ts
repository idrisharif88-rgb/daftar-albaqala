import { describe, expect, it } from 'vitest';
import { barcodeSvg } from './labels';

// jsdom has no canvas, which JsBarcode uses to measure the text under the bars.
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '', measureText: () => ({ width: 100 }),
})) as never;

describe('barcodeSvg', () => {
  it('draws vertical bars with the code under them', () => {
    const svg = barcodeSvg('2123456789010');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    // EAN-13 writes the number under the bars in three groups, like a shop barcode.
    for (const part of ['2', '123456', '789010']) expect(svg).toContain(`>${part}<`);
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(20);
  });
});
