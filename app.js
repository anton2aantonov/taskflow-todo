'use strict';

// Данные хранятся в localStorage браузера — сервер не требуется.
const STORAGE_KEY = 'taskflow.tasks.v1';
const MAX_TASK_LENGTH = 120;

const elements = {
  form: document.getElementById('task-form'),
  input: document.getElementById('task-input'),
  list: document.getElementById('task-list'),
  emptyState: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyDescription: document.getElementById('empty-description'),
  filterButtons: [...document.querySelectorAll('[data-filter]')],
  clearCompleted: document.getElementById('clear-completed'),
  taskCount: document.getElementById('task-count'),
  footerCounter: document.getElementById('footer-counter'),
  progressNumber: document.getElementById('progress-number'),
  progressTrack: document.getElementById('progress-track'),
  progressFill: document.getElementById('progress-fill'),
  progressDescription: document.getElementById('progress-description'),
  todayDate: document.getElementById('today-date'),
  storageWarning: document.getElementById('storage-warning'),
  announcer: document.getElementById('announcer'),
};

let storageReadFailed = false;
let tasks = readTasks();
let currentFilter = 'all';

function showStorageWarning(message) {
  elements.storageWarning.textContent = message;
  elements.storageWarning.hidden = false;
}

function readTasks() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Не перезаписываем данные, которые не удалось прочитать.
    storageReadFailed = true;
    showStorageWarning('Не удалось прочитать сохранённые задачи. Изменения доступны только до обновления страницы. Проверьте настройки браузера и перезагрузите страницу.');
    return [];
  }
  if (raw === null) return [];

  try {
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored)) throw new Error('Invalid task list');
    const usedIds = new Set();
    const reservedIds = new Set(stored.filter(task => task && typeof task.id === 'string').map(task => task.id));
    const restored = [];
    let repaired = false;
    for (const task of stored) {
      if (!task || typeof task.text !== 'string' || !task.text.trim() || typeof task.completed !== 'boolean') {
        repaired = true;
        continue;
      }
      const text = task.text.trim().slice(0, MAX_TASK_LENGTH);
      let id = task.id;
      if (typeof id !== 'string' || !id.trim() || usedIds.has(id)) {
        id = createTaskId(reservedIds);
        reservedIds.add(id);
        repaired = true;
      }
      usedIds.add(id);
      if (text !== task.text) repaired = true;
      restored.push({ id, text, completed: task.completed });
    }
    if (repaired) showStorageWarning('Сохранённые данные содержали ошибки. Доступные задачи восстановлены, идентификаторы исправлены. Исправленный список сохранится при следующем изменении.');
    return restored;
  } catch {
    showStorageWarning('Сохранённый список повреждён и не может быть прочитан. Можно создать новый список; при первом изменении он заменит повреждённые данные.');
    return [];
  }
}

function saveTasks() {
  if (storageReadFailed) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    elements.storageWarning.hidden = true;
  } catch {
    showStorageWarning('Не удалось сохранить задачи. Последние изменения могут пропасть после обновления страницы. Проверьте настройки и свободное место в хранилище браузера.');
  }
}

function createTaskId(usedIds = new Set(tasks.map(task => task.id))) {
  const base = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now() + '-' + Math.random().toString(36).slice(2);
  let id = base;
  let suffix = 1;
  while (usedIds.has(id)) id = base + '-' + suffix++;
  return id;
}

function announce(message) {
  elements.announcer.textContent = message;
}

function addTask(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  tasks.unshift({ id: createTaskId(), text: trimmed.slice(0, MAX_TASK_LENGTH), completed: false });
  saveTasks();
  render();
  announce('Задача добавлена');
}

function toggleTask(id) {
  const task = tasks.find(item => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
  announce(task.completed ? 'Задача выполнена' : 'Задача снова активна');
}

function deleteTask(id) {
  const index = tasks.findIndex(item => item.id === id);
  if (index === -1) return;
  tasks.splice(index, 1);
  saveTasks();
  render();
  announce('Задача удалена');
}

function pluralTasks(count) {
  const lastTwo = count % 100;
  const lastOne = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'задач';
  if (lastOne === 1) return 'задача';
  if (lastOne >= 2 && lastOne <= 4) return 'задачи';
  return 'задач';
}

function makeTaskElement(task) {
  const item = document.createElement('li');
  item.dataset.taskId = task.id;
  item.className = `task-item${task.completed ? ' is-completed' : ''}`;

  const checkLabel = document.createElement('label');
  checkLabel.className = 'task-check';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `Отметить задачу «${task.text}» как ${task.completed ? 'невыполненную' : 'выполненную'}`);
  checkbox.addEventListener('change', () => toggleTask(task.id));

  const checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkIcon.setAttribute('viewBox', '0 0 24 24');
  checkIcon.setAttribute('aria-hidden', 'true');
  const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  checkPath.setAttribute('d', 'm5 12 4.3 4.3L19 6.7');
  checkIcon.append(checkPath);
  checkLabel.append(checkbox, checkIcon);

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text; // textContent не исполняет введённый HTML.

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-button';
  deleteButton.setAttribute('aria-label', `Удалить задачу «${task.text}»`);
  const deleteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  deleteIcon.setAttribute('viewBox', '0 0 24 24');
  deleteIcon.setAttribute('aria-hidden', 'true');
  const deletePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  deletePath.setAttribute('d', 'M4 7h16M10 4h4m-8 3 1 13h10l1-13M10 11v5m4-5v5');
  deleteIcon.append(deletePath);
  deleteButton.append(deleteIcon);
  deleteButton.addEventListener('click', () => deleteTask(task.id));

  item.append(checkLabel, text, deleteButton);
  return item;
}

function render() {
  // Запоминаем активный элемент до пересоздания списка.
  const focused = document.activeElement;
  const rows = [...elements.list.children];
  const focusedIndex = rows.findIndex(row => row.contains(focused));
  const focusedId = focusedIndex >= 0 ? rows[focusedIndex].dataset.taskId : null;
  const controlSelector = focused && focused.type === 'checkbox' ? 'input' : 'button';
  const clearingFocused = focused === elements.clearCompleted;
  const remaining = tasks.filter(task => !task.completed).length;
  const completed = tasks.length - remaining;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;

  const visibleTasks = tasks.filter(task =>
    currentFilter === 'all' ||
    (currentFilter === 'active' && !task.completed) ||
    (currentFilter === 'completed' && task.completed)
  );

  elements.list.replaceChildren(...visibleTasks.map(makeTaskElement));
  elements.taskCount.textContent = tasks.length;
  elements.footerCounter.textContent = `Осталось: ${remaining} ${pluralTasks(remaining)}`;
  elements.progressNumber.textContent = `${progress}%`;
  elements.progressFill.style.width = `${progress}%`;
  elements.progressTrack.setAttribute('aria-valuenow', progress);
  elements.progressDescription.textContent = tasks.length === 0
    ? 'Начни с первой задачи'
    : remaining === 0 ? 'Все задачи выполнены. Отличная работа!' : `${completed} из ${tasks.length} выполнено`;
  elements.clearCompleted.disabled = completed === 0;
  elements.emptyState.hidden = visibleTasks.length > 0;

  if (tasks.length === 0) {
    elements.emptyTitle.textContent = 'Здесь пока чистый лист';
    elements.emptyDescription.textContent = 'Добавь первую задачу — и день уже станет организованнее.';
  } else if (visibleTasks.length === 0) {
    elements.emptyTitle.textContent = currentFilter === 'active' ? 'Активных задач нет' : 'Выполненных задач пока нет';
    elements.emptyDescription.textContent = currentFilter === 'active'
      ? 'Все дела на сегодня закончены. Так держать!'
      : 'Отметь задачу выполненной, и она появится здесь.';
  }

  if (focusedIndex >= 0) {
    const updatedRows = [...elements.list.children];
    const target = updatedRows.find(row => row.dataset.taskId === focusedId)
      || updatedRows[Math.min(focusedIndex, updatedRows.length - 1)];
    if (target) target.querySelector(controlSelector).focus();
    else elements.input.focus();
  } else if (clearingFocused && elements.clearCompleted.disabled) {
    elements.input.focus();
  }

  elements.filterButtons.forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  const text = elements.input.value;
  if (!text.trim()) {
    elements.input.value = '';
    elements.input.focus();
    return;
  }
  addTask(text);
  elements.input.value = '';
  elements.input.focus();
});

elements.filterButtons.forEach(button => {
  button.addEventListener('click', () => {
    currentFilter = button.dataset.filter;
    render();
  });
});

elements.clearCompleted.addEventListener('click', () => {
  const completedCount = tasks.filter(task => task.completed).length;
  if (!completedCount) return;
  tasks = tasks.filter(task => !task.completed);
  saveTasks();
  render();
  announce(`Удалено выполненных задач: ${completedCount}`);
});

elements.todayDate.textContent = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date());

render();
