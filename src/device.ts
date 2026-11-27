// Which words to use for the player's input: "Tap" on a touch screen, "Click" with a mouse. It follows whatever the player
// used last, so a laptop with a touch screen gets the words for the hand on the controls; before any input it asks the
// browser what the main pointer is.
let last: 'mouse' | 'touch' | null = null;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { last = e.pointerType === 'mouse' ? 'mouse' : 'touch'; }, { capture: true, passive: true });
export const usesTouch = () => (last ? last === 'touch' : typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
export const tapWord = () => (usesTouch() ? 'Tap' : 'Click');
