// Test-environment shims for browser features jsdom doesn't implement.

// <dialog>: jsdom has the element but not showModal()/close(). This minimal version tracks the
// open state and fires `close`; the real browser also makes the page inert and handles Escape.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, value?: string) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    if (value !== undefined) this.returnValue = value
    this.dispatchEvent(new Event('close'))
  }
}
