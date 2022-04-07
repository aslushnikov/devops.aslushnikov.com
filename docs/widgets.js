import {html} from './zhtml.js';
import {createEvent, emitEvent, consumeDOMEvent} from './utils.js';

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
  constructor(container) {
    this._container = container;
    this._element = null;
    this._anchor = null;
  }

  element() { return this._element; }

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
    const scrollLeft = window.pageXOffset || this._container.scrollLeft;
    const scrollTop = window.pageYOffset || this._container.scrollTop;
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
      this._container.appendChild(element);
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

const CROSS_CHARACTER = '✗';
export class FilterSelector extends HTMLElement {
  constructor(parameters) {
    super();

    this.events = {
      onchange: createEvent(),
      onremove: createEvent(),
    };

    this._parameters = parameters;

    this._chips = [
      html`<op-chip data-value="and" onclick=${this._onOpClick.bind(this)} class=and-chip>and</op-chip>`,
      html`<op-chip data-value="or" onclick=${this._onOpClick.bind(this)} class=or-chip>or</op-chip>`,
    ];

    this._equals = [
      html`<button data-value="equal" onclick=${this._onEqualClick.bind(this)}>=</button>`,
      html`<button data-value="nonequal" onclick=${this._onEqualClick.bind(this)}>≠</button>`,
    ];

    this._valueElement = html`<select oninput=${e => this._onValueChanged(e)}>
      <option selected disabled></option>
      ${[...parameters].map(([name, values]) => html`
        <optgroup label=${name}>
          ${[...values].sort().map(value => html`
            <option value="${JSON.stringify({name, value})}">${typeof value === 'string' ? value : `${name}: ${value}`}</option>
          `)}
        </optgroup>
      `)}
    </select>`;

    this._removeButton = html`<button onclick=${e => this._onRemoveButtonClicked(e)} class=remove-button>${CROSS_CHARACTER}</button>`;

    this._parenthesisLeft = html`<span class="parenthesis left"></span>`;
    this._parenthesisRight = html`<span class="parenthesis right"></span>`;

    this.append(this._chips[0]);
    this.append(this._parenthesisLeft);
    this.append(this._equals[0]);
    this.append(this._valueElement);
    this.append(this._removeButton);
    this.append(this._parenthesisRight);
  }

  setLeftParenthesisEnabled(value) {
    this._parenthesisLeft.classList.toggle('visible', value);
  }

  setRightParenthesisEnabled(value) {
    this._parenthesisRight.classList.toggle('visible', value);
  }

  _onEqualClick(e) {
    consumeDOMEvent(e);
    this._equals[0].replaceWith(this._equals[1]);
    this._equals.reverse();
    this._fireStateChanged();
  }

  _onOpClick(e) {
    consumeDOMEvent(e);
    this._chips[0].replaceWith(this._chips[1]);
    this._chips.reverse();
    this._fireStateChanged();
  }

  _onValueChanged(e) {
    consumeDOMEvent(e);
    this._fireStateChanged();
  }

  _onRemoveButtonClicked(e) {
    consumeDOMEvent(e);
    emitEvent(this.events.onremove);
  }

  _fireStateChanged() {
    this._state = null;
    emitEvent(this.events.onchange);
  }

  setOpChipHidden(hidden) {
    this._chips[0].classList.toggle('hidden', hidden);
    this._chips[1].classList.toggle('hidden', hidden);
  }

  setOpChip(value) {
    if (value !== 'and' && value !== 'or')
      throw new Error('ERROR: unknown operation chip name - ' + value);
    if (this._chips[0].dataset['value'] !== value) {
      this._chips[0].replaceWith(this._chips[1]);
      this._chips.reverse();
    }
  }

  setEqChip(value) {
    if (value !== 'equal' && value !== 'nonequal')
      throw new Error('ERROR: unknown equal chip name - ' + value);
    if (this._equals[0].dataset['value'] !== value) {
      this._equals[0].replaceWith(this._equals[1]);
      this._equals.reverse();
    }
  }

  isUndecided() {
    return this._valueElement.selectedIndex === 0;
  }

  setState(state) {
    this._valueElement.value = state.elementValue;
    this.setOpChip(state.op);
    this.setEqChip(state.eq);
  }

  state() {
    if (!this._state && !this.isUndecided()) {
      const json = JSON.parse(this._valueElement.value);
      this._state = {
        elementValue: this._valueElement.value,
        ...json,
        eq: this._equals[0].dataset['value'],
        op: this._chips[0].dataset['value'],
      };
    }
    return this._state;
  }
}
customElements.define('filter-selector', FilterSelector);

const PLUS_CHARACTER = '⊕';
export class FilterConjunctionGroup extends HTMLElement {
  constructor(parameters) {
    super();

    this.events = {
      onchange: createEvent(),
    };

    this._removeFilterButton = html`<a style="cursor: pointer; margin-right: 5px;" onclick=${() => this._onResetFilter()}>Reset filter</a>`;
    this._addFilterButtons = html`
      <span class=add-filter-buttons>
        <op-chip onclick=${() => void this._onAddFilter('and')} class=and-chip>and</op-chip>
        <op-chip onclick=${() => void this._onAddFilter('or')} class=or-chip>or</op-chip>
      </span>
    `;
    this._parameters = parameters;

    this._filters = new Set();

    this.append(this._removeFilterButton);
    this._onAddFilter();
  }

  _onResetFilter() {
    for (const f of this._filters)
      f.remove();
    this._filters.clear();
    this._onAddFilter();
    this._fireStateChanged();
  }

  _onAddFilter(operation = '') {
    const filter = new FilterSelector(this._parameters);
    if (operation)
      filter.setOpChip(operation);
    this._filters.add(filter);

    this.append(filter);
    filter.events.onchange(() => this._fireStateChanged());
    filter.events.onremove(() => this._onFilterRemoved(filter));
    this._fireStateChanged();
    return filter;
  }

  _onFilterRemoved(filter) {
    this._filters.delete(filter);
    filter.remove();
    this._fireStateChanged();
  }

  _fireStateChanged() {
    this._state = null;
    this._updateDecorations();
    emitEvent(this.events.onchange);
  }

  _updateDecorations() {
    const filters = [...this._filters];

    // Hide boolean operation for the very first filter.
    if (filters.length) {
      const [first, ...others] = filters;
      first.setOpChipHidden(true);
      first.setOpChip('and');
      for (const f of others)
        f.setOpChipHidden(false);
    }

    // Draw parenthesis around AND groups, if necessary.
    for (const f of filters) {
      f.setLeftParenthesisEnabled(false);
      f.setRightParenthesisEnabled(false);
    }
    const orGroups = this.state();
    if (orGroups.length > 1) {
      let counter = 0;
      for (const andGroup of orGroups) {
        if (andGroup.length > 1) {
          filters[counter].setLeftParenthesisEnabled(true);
          filters[counter + andGroup.length - 1].setRightParenthesisEnabled(true);
        }
        counter += andGroup.length;
      }
    }

    // Figure if we need to show the and/or button chips.
    if (!filters.length || filters.some(filter => filter.isUndecided()))
      this._addFilterButtons.remove();
    else
      this.append(this._addFilterButtons);
  }

  setState(andOrGroup) {
    for (const f of this._filters)
      f.remove();
    this._filters.clear();
    for (let i = 0; i < andOrGroup.length; ++i) {
      const andGroup = andOrGroup[i];
      for (let j = 0; j < andGroup.length; ++j) {
        const s = andGroup[j];
        const filter = this._onAddFilter();
        filter.setState(s);
        if (i !== 0 && j === 0)
          filter.setOpChip('or');
      }
    }
    this._fireStateChanged();
  }

  state() {
    if (!this._state) {
      const orGroups = [];
      let andGroup = null;
      for (const f of this._filters) {
        const state = f.state();
        if (!state)
          continue;
        if (!andGroup || state.op === 'or') {
          andGroup = [state];
          orGroups.push(andGroup);
        } else {
          andGroup.push(state);
        }
      }
      this._state = orGroups;
    }
    return this._state;
  }
}
customElements.define('filter-conjunction', FilterConjunctionGroup);

