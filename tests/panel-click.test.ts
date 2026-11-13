import { describe, expect, it } from 'vitest';
import { panelControl, type ClickNode, type PanelRoot } from '../src/panel-click';

/** A tiny stand-in for the page: just enough tree to ask `closest` and `contains`. */
class N implements PanelRoot {
  constructor(public name: string, public data: Record<string, string> = {}, public parent: N | null = null) {}
  child(name: string, data: Record<string, string> = {}) { return new N(name, data, this); }
  closest(selector: string): N | null {
    const keys = selector.split(',').map((s) => s.replace(/^\[data-|\]$/g, ''));
    for (let n: N | null = this; n; n = n.parent) if (keys.some((k) => k in n.data)) return n;
    return null;
  }
  contains(o: unknown): boolean { for (let n = o as N | null; n; n = n.parent) if (n === this) return true; return false; }
}

describe('what a click inside the hole panel means', () => {
  // body[data-tab="course"] > #side > #sidebody > details > summary > span
  const body = new N('body', { tab: 'course' });
  const side = body.child('side');
  const sidebody = side.child('sidebody');
  const details = sidebody.child('details', { sec: 'edit' });
  const summary = details.child('summary');
  const label = summary.child('span');

  it('a section header is not a control: the click must not be taken for a tab press on <body>', () => {
    // before the fix, this walked up to the body (which carries data-tab) and rebuilt the panel under the click
    expect(label.closest('[data-tab],[data-act],[data-hole]')).toBe(body);
    expect(panelControl(label as ClickNode, side)).toBeNull();
    expect(panelControl(summary as ClickNode, side)).toBeNull();
    expect(panelControl(sidebody as ClickNode, side)).toBeNull();
  });

  it('real controls inside the panel are still found, from the control or anything inside it', () => {
    const open = sidebody.child('button', { act: 'open', id: '1' });
    const inner = open.child('span');
    expect(panelControl(open as ClickNode, side)).toBe(open);
    expect(panelControl(inner as ClickNode, side)).toBe(open);
    const row = sidebody.child('button', { hole: '2' });
    expect(panelControl(row.child('b') as ClickNode, side)).toBe(row);
    const tab = side.child('button', { tab: 'money' });
    expect(panelControl(tab as ClickNode, side)).toBe(tab);
  });

  it('nothing outside the panel counts', () => {
    expect(panelControl(null, side)).toBeNull();
    expect(panelControl(body as ClickNode, side)).toBeNull();
    const elsewhere = body.child('canvas');
    expect(panelControl(elsewhere as ClickNode, side)).toBeNull();
  });
});
