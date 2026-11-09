// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import indexSrc from '../../../plugins-available/debt-ledger/index.mjs?raw';
import manifestSrc from '../../../plugins-available/debt-ledger/plugin.json?raw';
import { PluginHost, memoryCapabilities, type Bundle, type Loader, type Store } from '../../../block-host/src/index';

const loader: Loader = code => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const memory = (): Store => { let all: Record<string, Bundle> = {}; return { read: () => all, write: a => { all = a; } }; };
const bundle = (): Bundle => ({ format: 'plugin-bundle/1', manifest: JSON.parse(manifestSrc), files: { 'plugin.json': manifestSrc, 'index.mjs': indexSrc }, sha256: '' });
const lib = () => loader(indexSrc) as Promise<any>;

async function open(extra: Record<string, unknown> = {}, caps = memoryCapabilities()) {
  const host = new PluginHost(memory(), loader, { ...caps, ...extra });
  await host.install(bundle());
  const el = document.createElement('div');
  document.body.append(el);
  const close = host.mountScreen('debt-ledger', 'desk', el);
  const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
  const all = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
  const click = (sel: string) => q<HTMLElement>(sel).click();
  const type = (sel: string, v: string) => { const i = q<HTMLInputElement>(sel); i.value = v; i.dispatchEvent(new Event('input')); };
  const pick = (sel: string, v: string) => { const s = q<HTMLSelectElement>(sel); s.value = v; s.dispatchEvent(new Event('change')); };
  const addContact = (name: string, phone = '') => { click('[data-act=add-contact]'); type('[data-f=name]', name); if (phone) type('[data-f=phone]', phone); click('[data-act=save-contact]'); };
  const openContact = (name: string) => all('[data-contact]').find(c => c.textContent!.includes(name))!.click();
  const entry = (kind: 'debt' | 'payment', amount: string, cur?: string, note = '') => {
    click(`[data-act=${kind}]`); type('[data-f=amount]', amount); if (cur) pick('[data-f=cur]', cur); if (note) type('[data-f=note]', note);
    click('[data-act=record]');
  };
  return { host, el, close, q, all, click, type, pick, addContact, openContact, entry };
}

describe('Debt Ledger — pure logic', () => {
  it('balances per currency, never mixed; the book nets each contact FIRST', async () => {
    const m = await lib();
    const e = (contactId: string, type: string, amount: number, currency: string, no: number) => ({ id: `${no}`, no, contactId, type, amount, currency, date: '2026-01-01T00:00:00Z', note: '' });
    const entries = [e('a', 'debt', 1000, 'YER', 1), e('a', 'payment', 400, 'YER', 2), e('a', 'debt', 500, 'USD', 3), e('b', 'payment', 300, 'YER', 4)];
    expect(m.balanceOf(entries, 'a')).toEqual({ YER: 600, USD: 500 });
    expect(m.balanceOf(entries, 'b')).toEqual({ YER: -300 });
    expect(m.bookTotals([{ id: 'a' }, { id: 'b' }], entries)).toEqual({ YER: { toCollect: 600, toPay: 300 }, USD: { toCollect: 500, toPay: 0 } });
  });

  it('a reversal is the opposite entry and cancels the original exactly', async () => {
    const m = await lib();
    const orig = { id: 'x', no: 1, contactId: 'a', type: 'debt', amount: 700, currency: 'SAR', note: '', date: '2026-01-01T00:00:00Z' };
    const rev = m.reversalOf(orig, 2, 'reversal of #1');
    expect(rev).toMatchObject({ type: 'payment', amount: 700, currency: 'SAR', reverses: 'x', contactId: 'a' });
    expect(m.balanceOf([orig, rev], 'a')).toEqual({ SAR: 0 });
    expect([...m.reversedIds([orig, rev])]).toEqual(['x']);
  });

  it('statement: oldest first, running balance per currency', async () => {
    const m = await lib();
    const e = (no: number, type: string, amount: number, cur: string, date: string) => ({ id: `${no}`, no, contactId: 'a', type, amount, currency: cur, note: `n${no}`, date });
    const st = m.buildStatement([e(2, 'payment', 300, 'YER', '2026-02-01T00:00:00Z'), e(1, 'debt', 1000, 'YER', '2026-01-01T00:00:00Z'), e(3, 'debt', 50, 'USD', '2026-03-01T00:00:00Z')]);
    expect(st.map((s: any) => s.cur)).toEqual(['YER', 'USD']);
    expect(st[0].rows.map((r: any) => r.balance)).toEqual([1000, 700]);
    expect(st[0].balance).toBe(700);
  });

  it('formats money: YER without decimals, Arabic digits accepted', async () => {
    const m = await lib();
    expect(m.formatMoney(150000, 'YER')).toBe('1,500 YER');
    expect(m.formatMoney(250, 'SAR')).toBe('2.50 SAR');
    expect(m.toMinor('٢٫٥٠')).toBe(250);
    expect(m.toMinor('abc')).toBeNull();
  });
});

describe('Debt Ledger — screen', () => {
  it('is offered as a screen', async () => {
    const { host } = await open();
    expect(host.screens()).toEqual([{ pluginId: 'debt-ledger', id: 'desk', title: 'Debt Ledger', icon: '📒' }]);
  });

  it('adds a contact, records a debt and a payment, shows the running balance', async () => {
    const { el, q, click, addContact, openContact, entry } = await open();
    addContact('Khawlah', '777');
    expect(el.textContent).toContain('Khawlah');
    openContact('Khawlah');
    expect(q('[data-balance]').textContent).toContain('Settled');
    entry('debt', '1000');
    expect(q('[data-balance]').textContent).toBe('1,000 YER owes you');
    expect(q('[data-balance] .owes')).not.toBeNull();                          // red
    entry('payment', '400');
    expect(q('[data-balance]').textContent).toBe('600 YER owes you');
    entry('payment', '900');                                                    // over-paid → the other direction
    expect(q('[data-balance]').textContent).toBe('300 YER you owe');
    expect(q('[data-balance] .owe')).not.toBeNull();                            // green
  });

  it('keeps currencies apart on one contact', async () => {
    const { q, addContact, openContact, entry } = await open();
    addContact('Majed'); openContact('Majed');
    entry('debt', '1000', 'YER'); entry('debt', '5', 'USD'); entry('payment', '2', 'USD');
    expect(q('[data-balance]').textContent).toBe('1,000 YER owes you3.00 USD owes you');
  });

  it('refuses an empty name and a zero or bad amount', async () => {
    const { q, click, type, addContact, openContact } = await open();
    click('[data-act=add-contact]'); click('[data-act=save-contact]');
    expect(q('.toast').textContent).toBe('Enter a name.');
    click('[data-act=cancel-contact]');
    addContact('A'); openContact('A');
    click('[data-act=debt]'); type('[data-f=amount]', '0'); click('[data-act=record]');
    expect(q('.toast').textContent).toBe('Enter an amount above zero.');
    type('[data-f=amount]', 'abc'); click('[data-act=record]');
    expect(q('.toast').textContent).toBe('Enter an amount above zero.');
  });

  it('is append-only: a correction is an opposite entry, the original stays, and it can be reversed once', async () => {
    const { el, q, all, click, addContact, openContact, entry } = await open();
    addContact('A'); openContact('A');
    entry('debt', '500', 'YER', 'wrong');
    expect(all('[data-entry]').length).toBe(1);
    click('[data-act=reverse]');                                               // first tap asks «Sure?»
    expect(all('[data-entry]').length).toBe(1);
    click('[data-act=reverse]');                                               // second tap records the reversal
    expect(all('[data-entry]').length).toBe(2);                                // the original is still there
    expect(q('[data-balance]').textContent).toBe('Settled');
    expect(el.textContent).toContain('reversed');
    expect(el.textContent).toContain('reversal of #1');
    expect(all('[data-act=reverse]').length).toBe(0);                           // neither the original nor the reversal can be reversed again
  });

  it('contact delete is soft: two taps, hidden from the list, history kept in storage', async () => {
    const caps = memoryCapabilities();
    const { el, q, click, addContact, openContact, entry } = await open({}, caps);
    addContact('Temp'); openContact('Temp'); entry('debt', '10');
    click('[data-act=del-contact]'); expect(el.querySelector('[data-act=del-contact]')).not.toBeNull();
    click('[data-act=del-contact]');
    expect(el.querySelector('[data-contact]')).toBeNull();
    expect(q('[data-tab=contacts]').className).toBe('on');
    const stored = caps.storage('debt-ledger');
    expect(stored.get<any[]>('contacts', [])[0].deleted).toBe(true);
    expect(stored.get<any[]>('entries', []).length).toBe(1);                    // nothing erased
  });

  it('search filters the contacts, and the book totals show what is owed each way', async () => {
    const { el, q, click, type, addContact, openContact, entry } = await open();
    addContact('Alpha'); addContact('Beta');
    openContact('Alpha'); entry('debt', '800'); click('[data-act=back]');
    openContact('Beta'); entry('payment', '200'); click('[data-act=back]');
    expect(q('[data-totals]').textContent).toContain('800 YER');
    expect(q('[data-totals]').textContent).toContain('200 YER');
    type('[data-f=search]', 'alp');
    expect([...el.querySelectorAll<HTMLElement>('[data-contact]')].map(c => c.textContent)).toEqual([expect.stringContaining('Alpha')]);
  });

  it('prints the statement through the host', async () => {
    const print = vi.fn(async () => {});
    const { click, type, addContact, openContact, entry, q } = await open({ print, fontCss: async () => '/*font*/' });
    click('[data-tab=settings]'); type('[data-s=shop]', 'Abu Layth'); q<HTMLInputElement>('[data-s=shop]').dispatchEvent(new Event('change'));
    click('[data-tab=contacts]');
    addContact('Khawlah', '777'); openContact('Khawlah'); entry('debt', '1000', 'YER', 'cheese'); entry('payment', '400');
    click('[data-act=print]');
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    const [html, job] = print.mock.calls[0] as unknown as [string, string];
    expect(html).toContain('Abu Layth'); expect(html).toContain('Khawlah'); expect(html).toContain('cheese');
    expect(html).toContain('1,000 YER'); expect(html).toContain('600 YER');          // the running balance
    expect(html).toContain('/*font*/'); expect(job).toBe('Statement Khawlah');
  });

  it('shares a PDF statement; a long history takes several pages', async () => {
    const proxy = new Proxy({}, { get: () => () => ({ width: 10 }), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(proxy as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/2Q==');
    const share = vi.fn(async () => {});
    const { click, addContact, openContact, entry } = await open({ share });
    addContact('Khawlah'); openContact('Khawlah'); entry('debt', '10');
    click('[data-act=share]');
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [filename, b64, mime] = share.mock.calls[0] as unknown as [string, string, string];
    expect(filename).toMatch(/^statement-Khawlah-\d{4}-\d{2}-\d{2}\.pdf$/); expect(mime).toBe('application/pdf');
    expect(atob(b64)).toContain('/Count 1');

    const m = await lib();
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, no: i + 1, contactId: 'a', type: 'debt', amount: 100, currency: 'YER', note: `n${i}`, date: `2026-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z` }));
    const words = { statement: 'Statement', printed: 'Printed', balance: 'Balance', owes: 'owes you', owe: 'you owe', settled: 'Settled', noEntries: '-', dateCol: 'd', noteCol: 'n', debtCol: 'a', payCol: 'b', balCol: 'c' };
    const pages = await m.renderStatementPages({ name: 'A', phone: '1' }, many, { lang: 'en', title: 'T', shop: '', accent: '#000', footer: 'f' }, words);
    expect(pages.length).toBeGreaterThan(1);
    vi.restoreAllMocks();
  });

  it('says so when the host cannot print or share', async () => {
    const { q, click, addContact, openContact } = await open();
    addContact('A'); openContact('A');
    click('[data-act=print]'); expect(q('.toast').textContent).toBe('Printing is not available here.');
    click('[data-act=share]'); expect(q('.toast').textContent).toBe('Sharing is not available here.');
  });

  it('keeps everything across closing and reopening, and uses the language the host passes', async () => {
    const caps = memoryCapabilities();
    const host = new PluginHost(memory(), loader, caps);
    await host.install(bundle());
    const el = document.createElement('div');
    const close = host.mountScreen('debt-ledger', 'desk', el);
    (el.querySelector('[data-act=add-contact]') as HTMLElement).click();
    (el.querySelector('[data-f=name]') as HTMLInputElement).value = 'Majed'; el.querySelector('[data-f=name]')!.dispatchEvent(new Event('input'));
    (el.querySelector('[data-act=save-contact]') as HTMLElement).click();
    close();
    const el2 = document.createElement('div');
    host.mountScreen('debt-ledger', 'desk', el2, { lang: 'ar' });
    expect((el2.querySelector('.bd') as HTMLElement).dir).toBe('rtl');
    expect(el2.textContent).toContain('Majed');
  });
});

describe('Debt Ledger — pick from contacts', () => {
  it('fills the name and phone from the contact the host picks', async () => {
    const pickContact = vi.fn(async () => ({ name: 'Khawlah Ali', phone: '777123456' }));
    const { el, q, click, openContact } = await open({ pickContact });
    click('[data-act=add-contact]');
    click('[data-act=pick-contact]');
    await vi.waitFor(() => expect(q<HTMLInputElement>('[data-f=name]').value).toBe('Khawlah Ali'));
    expect(q<HTMLInputElement>('[data-f=phone]').value).toBe('777123456');
    click('[data-act=save-contact]');
    expect(el.textContent).toContain('Khawlah Ali');
    expect(el.textContent).toContain('777123456');
    openContact('Khawlah');
    expect(q('[data-name]').textContent).toBe('Khawlah Ali');
  });

  it('backing out of the picker changes nothing and shows no error', async () => {
    const pickContact = vi.fn(async () => null);
    const { q, click, type } = await open({ pickContact });
    click('[data-act=add-contact]'); type('[data-f=name]', 'Typed by hand');
    click('[data-act=pick-contact]');
    await vi.waitFor(() => expect(pickContact).toHaveBeenCalled());
    expect(q<HTMLInputElement>('[data-f=name]').value).toBe('Typed by hand');
    expect(q<HTMLElement>('.toast').hidden).toBe(true);
  });

  it('a host that cannot pick shows no contacts button (typing by hand still works)', async () => {
    const { el, click } = await open();
    click('[data-act=add-contact]');
    expect(el.querySelector('[data-act=pick-contact]')).toBeNull();
    expect(el.querySelector('[data-f=name]')).not.toBeNull();
  });

  it('a failing picker is reported politely', async () => {
    const pickContact = vi.fn(async () => { throw new Error('No contacts app on this device'); });
    const { q, click } = await open({ pickContact });
    click('[data-act=add-contact]'); click('[data-act=pick-contact]');
    await vi.waitFor(() => expect(q('.toast').textContent).toBe('No contacts app on this device'));
  });
});
