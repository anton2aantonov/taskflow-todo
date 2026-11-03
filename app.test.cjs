'use strict';
// Запуск: node app.test.cjs. Только встроенные модули Node.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'app.js'), 'utf8');
const key = 'taskflow.tasks.v1';

function boot(storage = {}, options = {}) {
  let document;
  function element(tag = '') {
    return {
      tag, value: '', hidden: false, disabled: false, textContent: '',
      children: [], dataset: {}, style: {}, attributes: {}, handlers: {},
      classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      append(...children) { this.children.push(...children); },
      contains(target) { return this === target || this.children.some(child => child.contains(target)); },
      replaceChildren(...children) {
        if (this.contains(document.activeElement)) document.activeElement = null;
        this.children = children;
      },
      querySelector(selector) {
        for (const child of this.children) {
          if (child.tag === selector) return child;
          const found = child.querySelector(selector);
          if (found) return found;
        }
        return null;
      },
      focus() { document.activeElement = this; },
    };
  }
  const nodes = new Map();
  const filters = ['all', 'active', 'completed'].map(filter => {
    const button = element('button');
    button.dataset.filter = filter;
    return button;
  });
  document = {
    activeElement: null,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelectorAll() { return filters; },
    createElement: element,
    createElementNS(namespace, tag) { return element(tag); },
  };
  const context = vm.createContext({ document, Intl, Date, Math,
    crypto: { randomUUID: () => 'fixed-id' }, // Намеренно провоцируем коллизии.
    localStorage: {
      getItem(name) { if (options.failRead) throw Error('read blocked'); return storage[name] ?? null; },
      setItem(name, value) { if (options.failWrite) throw Error('write blocked'); storage[name] = value; },
    },
  });
  vm.runInContext(source, context);
  return {
    nodes, document, filters, storage, options,
    run: code => vm.runInContext(code, context),
    rows: () => nodes.get('task-list').children,
    filter(name) { filters.find(button => button.dataset.filter === name).handlers.click(); },
    submit(value) {
      nodes.get('task-input').value = value;
      nodes.get('task-form').handlers.submit({ preventDefault() {} });
    },
  };
}

test('добавление через форму, пробелы, лимит, уникальные ID, безопасный текст', () => {
  const app = boot();
  app.submit('  Первая  ');
  app.submit('   ');
  assert.equal(app.run('tasks.length'), 1);
  assert.equal(app.run('tasks[0].text'), 'Первая');
  app.submit('x'.repeat(130));
  app.submit('<img src=x onerror=alert(1)>');
  assert.equal(app.run('tasks[1].text.length'), 120);
  assert.equal(app.run('new Set(tasks.map(task => task.id)).size'), 3);
  assert.equal(app.rows()[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(app.document.activeElement, app.nodes.get('task-input'));
});

test('отметка, прогресс, фильтры, перезагрузка, возврат в активные, удаление', () => {
  const storage = {};
  let app = boot(storage);
  app.submit('A'); app.submit('B');
  app.rows()[0].querySelector('input').handlers.change();
  assert.equal(app.nodes.get('progress-number').textContent, '50%');
  app.filter('active'); assert.equal(app.rows().length, 1);
  app.filter('completed'); assert.equal(app.rows().length, 1);
  app = boot(storage);
  assert.equal(app.run('tasks[0].completed'), true);
  app.rows()[0].querySelector('input').handlers.change();
  assert.equal(boot(storage).run('tasks[0].completed'), false);
  app.rows()[0].querySelector('button').handlers.click();
  assert.equal(boot(storage).run('tasks.length'), 1);
});

test('фокус: тот же флажок, следующая/предыдущая задача, пустой список', () => {
  const app = boot();
  app.submit('A'); app.submit('B'); app.submit('C');
  let control = app.rows()[1].querySelector('input');
  control.focus(); control.handlers.change();
  assert.equal(app.document.activeElement, app.rows()[1].querySelector('input'));
  control = app.rows()[1].querySelector('button');
  control.focus(); control.handlers.click();
  assert.equal(app.document.activeElement, app.rows()[1].querySelector('button'));
  control = app.rows()[1].querySelector('button');
  control.focus(); control.handlers.click();
  assert.equal(app.document.activeElement, app.rows()[0].querySelector('button'));
  control = app.rows()[0].querySelector('button');
  control.focus(); control.handlers.click();
  assert.equal(app.document.activeElement, app.nodes.get('task-input'));
});

test('фокус при исчезновении задачи под фильтром и массовом удалении', () => {
  const app = boot();
  app.submit('A'); app.submit('B'); app.filter('active');
  let control = app.rows()[0].querySelector('input');
  control.focus(); control.handlers.change();
  assert.equal(app.document.activeElement, app.rows()[0].querySelector('input'));
  control = app.rows()[0].querySelector('input');
  control.focus(); control.handlers.change();
  assert.equal(app.document.activeElement, app.nodes.get('task-input'));
  app.filter('completed');
  control = app.nodes.get('clear-completed');
  control.focus(); control.handlers.click();
  assert.equal(app.document.activeElement, app.nodes.get('task-input'));
  assert.equal(boot(app.storage).run('tasks.length'), 0);
});

test('повреждённый JSON и неверный корневой тип видны пользователю', () => {
  for (const raw of ['', '{bad', '{}', 'null']) {
    const app = boot({ [key]: raw });
    assert.equal(app.run('tasks.length'), 0);
    assert.equal(app.nodes.get('storage-warning').hidden, false);
    assert.match(app.nodes.get('storage-warning').textContent, /повреждён/);
    assert.equal(app.storage[key], raw); // При загрузке исходные данные не меняются.
    app.submit('Новый список');
    assert.equal(app.nodes.get('storage-warning').hidden, true);
    assert.equal(boot(app.storage).run('tasks.length'), 1);
  }
});

test('восстановление частичных данных, повторных, пустых и отсутствующих ID', () => {
  const storage = { [key]: JSON.stringify([
    { id: 'fixed-id', text: 'A', completed: false },
    { id: 'fixed-id', text: 'B', completed: true },
    { id: 'fixed-id-1', text: 'C', completed: false },
    { id: '', text: 'D', completed: false },
    { text: 'E', completed: false },
    null, { id: 'bad', text: '   ', completed: false },
    { id: 'bad2', text: 'F', completed: 'false' },
  ]) };
  const app = boot(storage);
  assert.equal(app.run('tasks.length'), 5);
  assert.equal(app.run('new Set(tasks.map(task => task.id)).size'), 5);
  assert.equal(app.nodes.get('storage-warning').hidden, false);
  app.run('toggleTask(tasks[1].id)');
  assert.equal(app.run('tasks.filter(task => task.completed).length'), 0);
  app.run('deleteTask(tasks[1].id)');
  assert.equal(app.run('tasks.length'), 4);
  assert.equal(boot(storage).run('tasks.length'), 4);
});

test('ошибка чтения не перезаписывает непрочитанный список', () => {
  const storage = { [key]: JSON.stringify([{ id: 'old', text: 'Old', completed: false }]) };
  const before = storage[key];
  const app = boot(storage, { failRead: true });
  assert.equal(app.nodes.get('storage-warning').hidden, false);
  app.submit('Temporary');
  assert.equal(app.run('tasks.length'), 1);
  assert.equal(storage[key], before);
  assert.equal(app.nodes.get('storage-warning').hidden, false);
});

test('ошибка записи: работа в памяти, предупреждение, успешная повторная запись', () => {
  const options = { failWrite: true };
  const app = boot({}, options);
  app.submit('A');
  assert.equal(app.run('tasks.length'), 1);
  assert.equal(app.nodes.get('storage-warning').hidden, false);
  assert.equal(app.storage[key], undefined);
  options.failWrite = false;
  app.submit('B');
  assert.equal(app.nodes.get('storage-warning').hidden, true);
  assert.equal(boot(app.storage).run('tasks.length'), 2);
});

test('кнопка добавления имеет доступное имя независимо от CSS', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<button[^>]*class="add-button"[^>]*aria-label="Добавить задачу"/);
});
