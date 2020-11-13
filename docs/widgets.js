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

    this._nameElement = html`<select oninput=${() => {
      this._renderValues();
      this._updateState();
    }}>
      ${[...parameters.keys()].map(key => html`
        <option>${key}</option>
      `)}
    </select>`;
    this._conditions = ['equal', 'unequal'],
    this._conditionElement = html`<button onclick=${() => {
      this._conditions.reverse();
      this._renderCondition();
      this._updateState();
    }}>=</button>`;
    this._valueElement = html`<select oninput=${() => this._updateState()}></select>`;
    this.append(this._nameElement);
    this.append(this._conditionElement);
    this.append(this._valueElement);
    this._renderCondition();
    this._renderValues();

    this._updateState(true /* muteOnChange */);
  }

  setNameValue(name) {
    if (!this._parameters.has(name))
      throw new Error(`There is no parameter with name "${name}"`);
    this._nameElement.value = name;
    this._renderValues();
    this._updateState(true /* muteOnChange */);
  }

  state() {
    return this._state;
  }

  _updateState(muteOnChange = false) {
    const entries = [...this._parameters.entries()];
    this._state = {
      name: entries[this._nameElement.selectedIndex][0],
      cnd: this._conditions[0],
      value: this._valueElement.selectedIndex === 0 ? 'any' : [...entries[this._nameElement.selectedIndex][1]][this._valueElement.selectedIndex - 1],
    };
    if (!muteOnChange)
      this._onchangeCallback(this, this._state);
  }

  _renderCondition() {
    if (this._conditions[0] === 'equal')
      this._conditionElement.textContent = '=';
    else
      this._conditionElement.textContent = '≠';
  }

  _renderValues() {
    this._valueElement.textContent = '';
    this._valueElement.append(html`
      <option>any</option>
      ${[...this._parameters.get(this._nameElement.value)].map(value => html`
            <option>${value + ''}</option>
      `)}
    `);
  }
}
customElements.define('filter-selector', FilterSelector);

const PLUS_CHARACTER = '⊕';
const CROSS_CHARACTER = '✗';
export class FilterGroup extends HTMLElement {
  constructor(parameters, onchange = () => {}) {
    super();

    this._addButton = html`<a onclick=${() => this._onAddFilter()} class=add-filter>Add Filter</a>`;
    this._parameters = parameters;
    this._onchange = onchange.bind(null, this);

    this._filterStates = new Map();

    this.append(this._addButton);
    this._onAddFilter();
  }

  _onAddFilter() {
    const filter = new FilterSelector(this._parameters, this._onFilterChanged.bind(this));
    // Pick a default filter name that wasn't used before.
    const allNames = new Set(this._parameters.keys());
    for (const state of this._filterStates.values())
      allNames.delete(state.name);
    if (allNames.size)
      filter.setNameValue([...allNames][0]);
    this._filterStates.set(filter, filter.state());

    const filterLine = html`
      <div>
        ${filter}<button class=remove-filter onclick=${event => {
          this._filterStates.delete(filter);
          filterLine.remove();
          this._onchange();
        }}>${CROSS_CHARACTER}</button>
      </div>
    `;

    this.insertBefore(filterLine, this._addButton);
  }

  _onFilterChanged(filter) {
    this._filterStates.set(filter, filter.state());
    this._onchange();
  }

  states() {
    return [...this._filterStates.values()];
  }
}
customElements.define('filter-group', FilterGroup);

