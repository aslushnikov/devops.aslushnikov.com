import {html } from './zhtml.js';

export class SortButton extends HTMLElement {
  constructor(callback = () => {}) {
    super();
    this._callback = callback;
    this.addEventListener('click', this._onClick.bind(this), false);
    this.setDirection(0);
  }

  _onClick() {
    if (this._direction !== 1)
      this._direction = 1;
    else
      this._direction = -1;
    this._render();
    this._callback.call(null, {direction: this._direction, target: this, });
  }

  _render() {
    if (this._direction === 1)
      this.textContent = '↓';
    else if (this._direction === -1)
      this.textContent = '↑';
    else
      this.textContent = '⇅';
  }

  direction() { return this._direction; }

  setDirection(direction) {
    this._direction = direction;
    this._render();
  }
}
customElements.define('sort-button', SortButton);

export class ExpandButton extends HTMLElement {
  constructor(callback = () => {}) {
    super();
    this._callback = callback;
    this._state = false;
    this.addEventListener('click', this._onClick.bind(this), false);
    this._render();
  }

  _render() {
    if (this._state)
      this.textContent = '⊟';
    else
      this.textContent = '⊞';
  }

  _onClick() {
    this._state = !this._state;
    this._render();
    this._callback.call(null, { open: this._state, target: this, } );
  }
}
customElements.define('expand-button', ExpandButton);

export class Popover {
  constructor(document) {
    this._document = document;
    this._element = null;
    this._anchor = null;
  }

  show(anchor, content) {
    const box = anchor.getBoundingClientRect();
    const class1 = box.y + box.height / 2 < window.innerHeight / 2 ? 'up' : 'down';
    const class2 = box.x + box.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    const element = html`
      <the-popover class=${class1 + '-' + class2}>
        <popover-arrow></popover-arrow>
        <popover-content>${content}</popover-content>
        <popover-arrow class=shadow></popover-arrow>
      </the-popover>
    `;
    const scrollLeft = window.pageXOffset || this._document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || this._document.documentElement.scrollTop;
    const pointX = box.x + box.width / 2 + scrollLeft;
    const pointY = (class1 === 'up' ? box.y + box.height : box.y) + scrollTop;
    element.style.left = pointX + 'px';
    element.style.top = pointY + 'px';
    element.addEventListener('click', e => {
      e.stopPropagation();
    }, false);
    if (this._element)
      this._element.replaceWith(element);
    else
      this._document.body.appendChild(element);
    this._element = element;
    this._anchor = anchor;
  }

  handleClick(mouseEvent, content) {
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    if (this.currentAnchor() === mouseEvent.target)
      this.hide();
    else
      this.show(mouseEvent.target, content);
  }

  onClickHandler(contentCallback) {
    return event => {
      event.preventDefault();
      event.stopPropagation();
      if (this.currentAnchor() === event.target)
        this.hide();
      else
        this.show(event.target, contentCallback());
    };
  }

  isShown() {
    return !!this._element;
  }

  currentAnchor() {
    return this._anchor;
  }

  hide() {
    if (!this._element)
      return;
    this._element.remove();
    this._element = null;
    this._anchor = null;
  }
}
