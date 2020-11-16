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

export class FilterSelector extends HTMLElement {
  constructor(parameters, onchange = () => {}) {
    super();

    this._parameters = parameters;
    this._onchangeCallback = onchange;

    this._conditions = ['equal', 'unequal'],
    this._conditionElement = html`<button onclick=${() => {
      this._conditions.reverse();
      this._renderCondition();
      this._updateState();
    }}>=</button>`;
    this._valueElement = html`<select oninput=${() => this._updateState()}>
      ${[...parameters].map(([name, values]) => html`
        <optgroup label=${name}>
          ${[...values].sort().map(value => html`
            <option value="${JSON.stringify({name, value})}">${typeof value === 'string' ? value : `${name}: ${value}`}</option>
          `)}
        </optgroup>
      `)}
    </select>`;
    this.append(this._conditionElement);
    this.append(this._valueElement);
    this._renderCondition();
  }

  state() {
    if (!this._state) {
      const json = JSON.parse(this._valueElement.value);
      this._state = {
        ...json,
        cnd: this._conditions[0],
      };
    }
    return this._state;
  }

  _updateState() {
    this._state = null;
    this._onchangeCallback(this, this.state());
  }

  _renderCondition() {
    if (this._conditions[0] === 'equal')
      this._conditionElement.textContent = '=';
    else
      this._conditionElement.textContent = '≠';
  }
}
customElements.define('filter-selector', FilterSelector);

const PLUS_CHARACTER = '⊕';
const CROSS_CHARACTER = '✗';
export class FilterConjunctionGroup extends HTMLElement {
  constructor(parameters, onchange = () => {}) {
    super();

    this._addFilterButton = html`<a style="cursor: pointer" onclick=${() => this._onAddFilter()}>Add filter</a>`;
    this._addButton = html`<a onclick=${() => this._onAddFilter()} class="add-filter and-chip">and</a>`;
    this._parameters = parameters;
    this._onchange = onchange.bind(null, this);

    this._filterStates = new Map();

    this.append(this._addFilterButton);
  }

  _onAddFilter(fire = true) {
    const filter = new FilterSelector(this._parameters, this._onFilterChanged.bind(this));
    this._filterStates.set(filter, filter.state());
    this._addFilterButton.remove();

    let andChip = null;
    if (this._filterStates.size > 1) {
      andChip = html`<span class=and-chip>and</span>`;
      this.append(andChip);
    }
    const filterChip = html`
      <div class=filter-chip>
        ${filter}<button class=remove-filter onclick=${event => {
          this._filterStates.delete(filter);
          filterChip.remove();
          if (andChip)
            andChip.remove();
          if (this.firstElementChild && this.firstElementChild.classList.contains('and-chip'))
            this.firstElementChild.remove();
          if (!this._filterStates.size)
            this.append(this._addFilterButton);
          this._onchange();
        }}>${CROSS_CHARACTER}</button>
      </div>
    `;

    this._addButton.remove();
    this.append(filterChip);
    this.append(this._addButton);
    if (fire)
      this._onFilterChanged(filter);
  }

  _onFilterChanged(filter) {
    this._filterStates.set(filter, filter.state());
    this._onchange();
  }

  states() {
    return [...this._filterStates.values()];
  }
}
customElements.define('filter-conjunction', FilterConjunctionGroup);

