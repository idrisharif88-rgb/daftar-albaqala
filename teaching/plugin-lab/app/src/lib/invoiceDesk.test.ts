// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import indexSrc from '../../../plugins-available/invoice-desk/index.mjs?raw';
import manifestSrc from '../../../plugins-available/invoice-desk/plugin.json?raw';
import { PluginHost, memoryCapabilities, type Bundle, type Loader, type Store } from './pluginHost';

const loader: Loader = code => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const memory = (): Store => { let all: Record<string, Bundle> = {}; return { read: () => all, write: a => { all = a; } }; };
const bundle = (): Bundle => ({ format: 'plugin-bundle/1', manifest: JSON.parse(manifestSrc), files: { 'plugin.json': manifestSrc, 'index.mjs': indexSrc }, sha256: '' });
const lib = () => loader(indexSrc) as Promise<any>;

async function open(extra: Record<string, unknown> = {}, caps = memoryCapabilities()) {
  const host = new PluginHost(memory(), loader, { ...caps, ...extra });
  await host.install(bundle());
  const el = document.createElement('div');
  document.body.append(el);
  const close = host.mountScreen('invoice-desk', 'desk', el);
  const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
  const all = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
  const click = (sel: string) => q<HTMLElement>(sel).click();
  const type = (sel: string, v: string) => { const i = q<HTMLInputElement>(sel); i.value = v; i.dispatchEvent(new Event('input')); };
  const pick = (sel: string, v: string) => { const s = q<HTMLSelectElement>(sel); s.value = v; s.dispatchEvent(new Event('change')); };
  const addItem = (name: string, price: string, cur?: string) => {
    click('[data-tab=items]'); type('[data-f=name]', name); type('[data-f=price]', price);
    if (cur) pick('[data-f=cur]', cur);
    click('[data-act=add]');
  };
  const inRow = (name: string, act: string) => all('[data-item]').find(r => r.textContent!.includes(name))!.querySelector<HTMLElement>(`[data-act=${act}]`)!.click();
  return { host, el, close, q, all, click, type, pick, addItem, inRow };
}

describe('Invoice Desk — logic', () => {
  it('money, quantity, total and numbering helpers', async () => {
    const m = await lib();
    expect(m.toMinor('٢٫٥٠')).toBe(250);
    expect(m.toMinor('abc')).toBeNull();
    expect(m.toQty('٣')).toBe(3);
    expect(m.toQty('0')).toBeNull();
    expect(m.formatMoney(150000, 'YER')).toBe('1,500 YER');
    expect(m.formatMoney(250, 'SAR')).toBe('2.50 SAR');
    expect(m.invoiceTotal([{ price: 250, qty: 3 }, { price: 100, qty: 2 }])).toBe(950);
    expect(m.nextInvoiceNumber(0, [])).toBe(1);
    expect(m.nextInvoiceNumber(7, [{ no: 3 }])).toBe(8);
    expect(m.nextInvoiceNumber(2, [{ no: 12 }, { no: 5 }])).toBe(13);      // history wins when the counter was lost
  });

  it('buildPdf makes a valid multi-page PDF', async () => {
    const m = await lib();
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const text = Buffer.from(m.buildPdf([{ jpeg, w: 1, h: 1 }, { jpeg, w: 1, h: 1 }, { jpeg, w: 1, h: 1 }])).toString('latin1');
    expect(text).toContain('/Count 3');
    const at = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(at).split('\n').filter(l => /^\d{10} 00000 n/.test(l));
    entries.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

describe('Invoice Desk — screen', () => {
  it('is offered as a screen and starts with the invoice tab', async () => {
    const { host, q } = await open();
    expect(host.screens()).toEqual([{ pluginId: 'invoice-desk', id: 'desk', title: 'Invoice Desk', icon: '🧾' }]);
    expect(q('[data-tab=invoice]').className).toBe('on');
  });

  it('price list: add, edit, delete (two taps)', async () => {
    const { el, q, click, type, addItem } = await open();
    addItem('Cheese', '800');
    expect(el.querySelector('[data-item]')!.textContent).toContain('800 YER');
    click('[data-act=edit]'); type('[data-f=price]', '900'); click('[data-act=add]');
    expect(el.querySelector('[data-item]')!.textContent).toContain('900 YER');
    click('[data-act=del]'); expect(el.querySelector('[data-item]')).not.toBeNull();
    click('[data-act=del]'); expect(el.querySelector('[data-item]')).toBeNull();
    click('[data-act=add]');
    expect(q('.toast').textContent).toBe('Enter a name.');
    type('[data-f=name]', 'X'); type('[data-f=price]', 'zz'); click('[data-act=add]');
    expect(q('.toast').textContent).toBe('Enter a valid price.');
  });

  it('builds an invoice, reviews it, records it with number 1, then number 2', async () => {
    const { el, q, all, click, type, addItem, inRow } = await open();
    addItem('Cheese', '800'); addItem('Sugar', '500');
    click('[data-tab=invoice]');
    inRow('Cheese', 'inc'); inRow('Cheese', 'inc'); inRow('Cheese', 'inc'); inRow('Sugar', 'inc'); inRow('Sugar', 'inc');
    expect(q('[data-total]').textContent).toBe('3,400 YER');
    type('[data-f=customer]', 'Idris');
    click('[data-act=review]');
    expect(q('[data-doc-no]').getAttribute('data-doc-no')).toBe('1');          // peeked, not used up
    expect(el.textContent).toContain('Idris');
    expect(all('[data-line]').map(r => r.dataset.line)).toEqual(['Sugar', 'Cheese']);  // newest first, as in the list
    click('[data-act=confirm]');
    expect(q('[data-doc-no]').getAttribute('data-doc-no')).toBe('1');
    expect(q('[data-doc-total]').textContent).toBe('Total: 3,400 YER');
    click('[data-act=new]');
    expect(q('[data-total]').textContent).toBe('0 YER');                       // basket is empty again
    inRow('Sugar', 'inc'); click('[data-act=review]'); click('[data-act=confirm]');
    expect(q('[data-doc-no]').getAttribute('data-doc-no')).toBe('2');
  });

  it('an abandoned draft leaves no gap in the numbering', async () => {
    const { q, click, addItem, inRow } = await open();
    addItem('Tea', '100');
    click('[data-tab=invoice]'); inRow('Tea', 'inc');
    click('[data-act=review]'); click('[data-act=back]');                      // abandon
    click('[data-act=review]'); click('[data-act=confirm]');
    expect(q('[data-doc-no]').getAttribute('data-doc-no')).toBe('1');
  });

  it('removing every line in the review returns to picking items', async () => {
    const { q, click, addItem, inRow } = await open();
    addItem('Tea', '100');
    click('[data-tab=invoice]'); inRow('Tea', 'inc'); click('[data-act=review]');
    click('[data-act=dec]');
    expect(q('[data-total]')).not.toBeNull();
    expect(q('[data-act=confirm]')).toBeNull();
  });

  it('one currency per invoice: other currencies are hidden and switching clears the basket', async () => {
    const { el, q, click, pick, addItem, inRow } = await open();
    addItem('Rice', '1000'); addItem('Tea', '5', 'USD');
    click('[data-tab=invoice]');
    expect(el.textContent).toContain('Rice'); expect(el.textContent).not.toContain('Tea');
    inRow('Rice', 'inc');
    pick('[data-f=cur]', 'USD');
    expect(el.textContent).toContain('Tea'); expect(el.textContent).not.toContain('Rice');
    expect(q('[data-total]').textContent).toBe('0.00 USD');
  });

  it('history lists invoices, opens one, and deleting never reuses its number', async () => {
    const { el, q, click, addItem, inRow } = await open();
    addItem('Tea', '100');
    for (let i = 0; i < 2; i++) { click('[data-tab=invoice]'); inRow('Tea', 'inc'); click('[data-act=review]'); click('[data-act=confirm]'); click('[data-act=new]'); }
    click('[data-tab=history]');
    expect([...el.querySelectorAll<HTMLElement>('[data-inv]')].map(e => e.dataset.inv)).toEqual(['2', '1']);
    (q('[data-inv="2"]') as HTMLElement).click();
    click('[data-act=del-inv]'); click('[data-act=del-inv]');                  // two taps
    click('[data-tab=history]');
    expect([...el.querySelectorAll<HTMLElement>('[data-inv]')].map(e => e.dataset.inv)).toEqual(['1']);
    click('[data-tab=invoice]'); inRow('Tea', 'inc'); click('[data-act=review]');
    expect(q('[data-doc-no]').getAttribute('data-doc-no')).toBe('3');          // not 2 again
  });

  it('prints through the host with the shop name, customer and total', async () => {
    const print = vi.fn(async () => {});
    const { q, click, type, pick, addItem, inRow } = await open({ print, fontCss: async () => '/*font*/' });
    click('[data-tab=settings]'); type('[data-s=shop]', 'Abu Layth'); q<HTMLInputElement>('[data-s=shop]').dispatchEvent(new Event('change'));
    addItem('Cheese', '800');
    click('[data-tab=invoice]'); inRow('Cheese', 'inc'); type('[data-f=customer]', 'Khawlah');
    click('[data-act=review]'); click('[data-act=confirm]'); click('[data-act=print]');
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    const [html, job] = print.mock.calls[0] as unknown as [string, string];
    expect(html).toContain('Abu Layth'); expect(html).toContain('Khawlah'); expect(html).toContain('800 YER');
    expect(html).toContain('/*font*/'); expect(job).toBe('Invoice 1');
    expect(pick).toBeDefined();
  });

  it('shares a PDF through the host — one page for a short invoice, several for a long one', async () => {
    const proxy = new Proxy({}, { get: () => () => ({ width: 10 }), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(proxy as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/2Q==');
    const share = vi.fn(async () => {});
    const { click, addItem, inRow } = await open({ share });
    addItem('Tea', '100');
    click('[data-tab=invoice]'); inRow('Tea', 'inc'); click('[data-act=review]'); click('[data-act=confirm]'); click('[data-act=share]');
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [filename, b64, mime] = share.mock.calls[0] as unknown as [string, string, string];
    expect(filename).toBe('invoice-1.pdf'); expect(mime).toBe('application/pdf');
    expect(atob(b64)).toContain('/Count 1');

    const m = await lib();
    const lines = Array.from({ length: 60 }, (_, i) => ({ name: `Item ${i}`, price: 100, qty: 1 }));
    const pages = await m.renderInvoicePages({ no: 9, date: new Date().toISOString(), customer: '', cur: 'YER', lines, total: 6000 },
      { lang: 'en', title: 'T', shop: '', accent: '#000', footer: 'Thanks' }, { invNo: 'Invoice', date: 'Date', customer: 'Customer', noCustomer: '-', itemCol: 'i', priceCol: 'p', qtyCol: 'q', sumCol: 's', total: 'Total' });
    expect(pages.length).toBeGreaterThan(1);                                    // 60 rows do not fit one A4 page
    vi.restoreAllMocks();
  });

  it('says so when the host cannot print or share', async () => {
    const { q, click, addItem, inRow } = await open();
    addItem('Tea', '100');
    click('[data-tab=invoice]'); inRow('Tea', 'inc'); click('[data-act=review]'); click('[data-act=confirm]');
    click('[data-act=print]'); expect(q('.toast').textContent).toBe('Printing is not available here.');
    click('[data-act=share]'); expect(q('.toast').textContent).toBe('Sharing is not available here.');
  });

  it('keeps everything across closing and reopening, and follows the language option', async () => {
    const caps = memoryCapabilities();
    const host = new PluginHost(memory(), loader, caps);
    await host.install(bundle());
    const el = document.createElement('div');
    const close = host.mountScreen('invoice-desk', 'desk', el);
    (el.querySelector('[data-tab=items]') as HTMLElement).click();
    (el.querySelector('[data-f=name]') as HTMLInputElement).value = 'Rice'; el.querySelector('[data-f=name]')!.dispatchEvent(new Event('input'));
    (el.querySelector('[data-f=price]') as HTMLInputElement).value = '9'; el.querySelector('[data-f=price]')!.dispatchEvent(new Event('input'));
    (el.querySelector('[data-act=add]') as HTMLElement).click();
    close();
    const el2 = document.createElement('div');
    host.mountScreen('invoice-desk', 'desk', el2, { lang: 'ar' });              // the host passes its language
    expect((el2.querySelector('.bd') as HTMLElement).dir).toBe('rtl');
    (el2.querySelector('[data-tab=items]') as HTMLElement).click();
    expect(el2.textContent).toContain('Rice');
  });
});
