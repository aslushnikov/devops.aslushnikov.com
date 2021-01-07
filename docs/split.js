import {html} from './zhtml.js';
import {onDOMEvent, disposeAll, consumeDOMEvent} from './utils.js';

const sidebarPositionToCSSClass = {
  'left': 'sidebar-left',
  'right': 'sidebar-right',
  'top': 'sidebar-top',
  'bottom': 'sidebar-bottom',
};

const sidebarPositionToCSSOrientation = {
  'left': 'horizontal',
  'right': 'horizontal',
  'top': 'vertical',
  'bottom': 'vertical',
};

export const split = {
  left: ({sidebar, main, size, hidden = false}) => splitElement(sidebar, main, size, hidden, 'left'),
  right: ({sidebar, main, size, hidden = false}) => splitElement(sidebar, main, size, hidden, 'right'),
  top: ({sidebar, main, size, hidden = false}) => splitElement(sidebar, main, size, hidden, 'top'),
  bottom: ({sidebar, main, size, hidden = false}) => splitElement(sidebar, main, size, hidden, 'bottom'),
  hideSidebar: (splitElement) => splitElement.removeAttribute('sidebar-shown'),
  showSidebar: (splitElement) => splitElement.setAttribute('sidebar-shown', true),
};

function splitElement(sidebar, main, size, hidden, sidebarPosition) {
  const mainPane = html`<main-pane>${main}</main-pane>`;
  const resizer = html`<split-resizer></split-resizer>`;
  const sidePane = html`<side-pane>${sidebar}</side-pane>`;
  const element = html`
    <split-element class="foo ${sidebarPositionToCSSClass[sidebarPosition]} ${sidebarPositionToCSSOrientation[sidebarPosition]}">
      ${sidePane}
      ${resizer}
      ${mainPane}
    </split-element>
  `;
  if (!hidden)
    element.setAttribute('sidebar-shown', true);

  setupResizer(sidePane, resizer, sidebarPosition, size);
  return element;
}

function setupResizer(sideElement, resizerElement, sidebarPosition, initialSize) {
  sideElement.style.setProperty('--size', initialSize);

  const domEvents = [];
  const axis = sidebarPosition === 'left' || sidebarPosition === 'right' ? 'pageX' : 'pageY';
  const coeff = sidebarPosition === 'bottom' || sidebarPosition === 'right' ? -1 : 1;
  let initialCoordinate = 0;

  const initialize = event => {
    consumeDOMEvent(event);
    disposeAll(domEvents);
    initialCoordinate = event[axis];
    domEvents.push(
      onDOMEvent(document, 'mousemove', event => update(event, false /* commit */)),
      onDOMEvent(document, 'mouseup', event => update(event, true /* commit */)),
      onDOMEvent(document, 'mouseleave', event => update(event, true /* commit */)),
    );
  };

  const update = (event, commit) => {
    consumeDOMEvent(event);
    const delta = (event[axis] - initialCoordinate) * coeff;
    sideElement.style.setProperty('--size', (initialSize + delta) + 'px');
    if (!commit)
      return;

    initialSize += delta;
    disposeAll(domEvents);
    domEvents.push(onDOMEvent(resizerElement, 'mousedown', initialize));
  };

  domEvents.push(onDOMEvent(resizerElement, 'mousedown', initialize));
}
