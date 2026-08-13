export function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function nextQueuePhase(phase, taskIndex, taskCount) {
  if (phase === 'work' && taskIndex >= taskCount - 1) return { phase: 'done', taskIndex };
  if (phase === 'work') return { phase: 'break', taskIndex };
  return { phase: 'work', taskIndex: taskIndex + 1 };
}

export function totalQueueMinutes(tasks, breakMinutes) {
  const work = tasks.reduce((sum, task) => sum + task.minutes, 0);
  return work + (breakMinutes * Math.max(0, tasks.length - 1));
}

function init() {
  const taskForm = document.querySelector('#taskForm');
  const taskNameInput = document.querySelector('#taskName');
  const taskMinutesInput = document.querySelector('#taskMinutes');
  const taskList = document.querySelector('#taskList');
  const breakInput = document.querySelector('#breakMinutes');
  const planner = document.querySelector('#planner');
  const planSummary = document.querySelector('#planSummary');
  const timer = document.querySelector('#timer');
  const timerDisplay = document.querySelector('#timerDisplay');
  const phaseLabel = document.querySelector('#phaseLabel');
  const activeTaskLabel = document.querySelector('#activeTaskLabel');
  const setLabel = document.querySelector('#setLabel');
  const progress = document.querySelector('#progress');
  const startButton = document.querySelector('#startButton');
  const skipButton = document.querySelector('#skipButton');
  const resetButton = document.querySelector('#resetButton');
  const status = document.querySelector('#status');
  const soundButton = document.querySelector('#soundButton');
  const soundLabel = document.querySelector('#soundLabel');

  const savedTasks = JSON.parse(localStorage.getItem('ro-tasks') || '[]');
  let tasks = Array.isArray(savedTasks) ? savedTasks.filter((task) => task?.name && Number.isFinite(task?.minutes)) : [];
  let sessionTasks = [];
  let breakMinutes = Number(localStorage.getItem('ro-break')) || 5;
  let taskIndex = 0;
  let phase = 'work';
  let totalSeconds = 0;
  let remainingSeconds = 0;
  let intervalId = null;
  let running = false;
  let started = false;
  let soundOn = localStorage.getItem('ro-sound') !== 'off';

  breakInput.value = String(breakMinutes);

  function clampNumber(input, fallback) {
    const value = Number.parseInt(input.value, 10);
    const min = Number(input.min);
    const max = Number(input.max);
    const safe = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    input.value = String(safe);
    return safe;
  }

  function humanDuration(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} t ${rest} min` : `${hours} t`;
  }

  function savePlanner() {
    localStorage.setItem('ro-tasks', JSON.stringify(tasks));
    localStorage.setItem('ro-break', String(breakMinutes));
  }

  function updateSummary() {
    if (!tasks.length) {
      planSummary.textContent = 'Ingen oppgaver lagt til ennå.';
      return;
    }
    const pauses = Math.max(0, tasks.length - 1);
    planSummary.textContent = `${tasks.length} ${tasks.length === 1 ? 'oppgave' : 'oppgaver'} · ${pauses} ${pauses === 1 ? 'pause' : 'pauser'} · ${humanDuration(totalQueueMinutes(tasks, breakMinutes))} totalt`;
  }

  function renderTaskList() {
    taskList.replaceChildren();
    tasks.forEach((task, index) => {
      const item = document.createElement('li');
      const number = document.createElement('span');
      number.className = 'task-number';
      number.textContent = String(index + 1);
      const name = document.createElement('p');
      name.textContent = task.name;
      const duration = document.createElement('span');
      duration.className = 'task-duration';
      duration.textContent = `${task.minutes} min`;
      const remove = document.createElement('button');
      remove.className = 'remove-task';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Fjern ${task.name}`);
      remove.addEventListener('click', () => {
        tasks.splice(index, 1);
        savePlanner();
        renderPlanner();
      });
      item.append(number, name, duration, remove);
      taskList.append(item);
    });
  }

  function renderPlanner() {
    renderTaskList();
    updateSummary();
    startButton.disabled = tasks.length === 0;
    if (!started) {
      totalSeconds = tasks.length ? tasks[0].minutes * 60 : 0;
      remainingSeconds = totalSeconds;
      taskIndex = 0;
      activeTaskLabel.textContent = tasks[0]?.name || 'Legg til en oppgave';
      setLabel.textContent = tasks.length ? `Oppgave 1 av ${tasks.length}` : '0 av 0';
      status.textContent = tasks.length ? 'Trykk start når du er klar.' : 'Legg til den første oppgaven din.';
      updateView();
    }
  }

  function renderProgress() {
    progress.replaceChildren();
    const visibleTasks = started ? sessionTasks : tasks;
    visibleTasks.forEach((_, index) => {
      const dot = document.createElement('span');
      dot.classList.toggle('done', index < taskIndex || phase === 'done');
      dot.classList.toggle('current', index === taskIndex && phase !== 'done');
      progress.append(dot);
    });
  }

  function updateView() {
    const activeTasks = started ? sessionTasks : tasks;
    const elapsed = Math.max(0, totalSeconds - remainingSeconds);
    timer.style.setProperty('--progress', `${totalSeconds ? (elapsed / totalSeconds) * 360 : 0}deg`);
    timer.classList.toggle('break', phase === 'break');
    timerDisplay.textContent = formatTime(remainingSeconds);
    timerDisplay.dateTime = `PT${Math.ceil(remainingSeconds / 60)}M`;
    phaseLabel.textContent = phase === 'break' ? 'Pause' : phase === 'done' ? 'Ferdig' : activeTasks.length ? 'Arbeid' : 'Klar';
    activeTaskLabel.textContent = phase === 'break'
      ? `Neste: ${activeTasks[taskIndex + 1]?.name || ''}`
      : phase === 'done'
        ? 'Alle oppgavene er fullført'
        : activeTasks[taskIndex]?.name || 'Legg til en oppgave';
    setLabel.textContent = phase === 'break'
      ? `Pause ${taskIndex + 1} av ${Math.max(0, activeTasks.length - 1)}`
      : phase === 'done'
        ? `${activeTasks.length} av ${activeTasks.length} oppgaver`
        : activeTasks.length ? `Oppgave ${taskIndex + 1} av ${activeTasks.length}` : '0 av 0';
    document.title = running ? `${formatTime(remainingSeconds)} — ${phase === 'break' ? 'Pause' : activeTasks[taskIndex]?.name}` : 'Ro — oppgavetimer';
    renderProgress();
  }

  function playChime() {
    if (!soundOn) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = phase === 'break' ? 660 : 520;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.65);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.7);
  }

  function stopInterval() {
    window.clearInterval(intervalId);
    intervalId = null;
    running = false;
  }

  function finishPlan() {
    stopInterval();
    phase = 'done';
    remainingSeconds = 0;
    startButton.textContent = 'Ferdig';
    startButton.disabled = true;
    skipButton.hidden = true;
    status.textContent = `Bra jobbet — du fullførte ${sessionTasks.length} ${sessionTasks.length === 1 ? 'oppgave' : 'oppgaver'}.`;
    playChime();
    updateView();
  }

  function advancePhase() {
    stopInterval();
    const next = nextQueuePhase(phase, taskIndex, sessionTasks.length);
    phase = next.phase;
    taskIndex = next.taskIndex;
    if (phase === 'done') {
      finishPlan();
      return;
    }
    totalSeconds = (phase === 'work' ? sessionTasks[taskIndex].minutes : breakMinutes) * 60;
    remainingSeconds = totalSeconds;
    startButton.textContent = phase === 'break' ? 'Start pausen' : 'Start oppgaven';
    status.textContent = phase === 'break' ? 'Ta pausen. Den er en del av planen.' : 'Klar for neste oppgave.';
    playChime();
    updateView();
  }

  function tick() {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      remainingSeconds = 0;
      updateView();
      advancePhase();
      return;
    }
    updateView();
  }

  function toggleTimer() {
    if (phase === 'done' || !tasks.length) return;
    if (running) {
      stopInterval();
      startButton.textContent = 'Fortsett';
      status.textContent = 'Timeren er satt på pause.';
      updateView();
      return;
    }
    if (!started) {
      sessionTasks = tasks.map((task) => ({ ...task }));
      started = true;
      taskIndex = 0;
      phase = 'work';
      totalSeconds = sessionTasks[0].minutes * 60;
      remainingSeconds = totalSeconds;
      planner.classList.add('disabled');
      resetButton.hidden = false;
      skipButton.hidden = false;
    }
    running = true;
    startButton.textContent = 'Pause';
    status.textContent = phase === 'break' ? 'Nå tar du pause.' : 'Hold fokus på denne oppgaven.';
    intervalId = window.setInterval(tick, 1000);
    updateView();
  }

  function reset() {
    stopInterval();
    started = false;
    sessionTasks = [];
    phase = 'work';
    taskIndex = 0;
    planner.classList.remove('disabled');
    startButton.textContent = 'Start';
    skipButton.hidden = true;
    resetButton.hidden = true;
    renderPlanner();
  }

  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = taskNameInput.value.trim();
    const minutes = clampNumber(taskMinutesInput, 25);
    if (!name) return;
    tasks.push({ name, minutes });
    taskNameInput.value = '';
    savePlanner();
    renderPlanner();
    taskNameInput.focus();
  });

  breakInput.addEventListener('change', () => {
    breakMinutes = clampNumber(breakInput, 5);
    savePlanner();
    updateSummary();
  });
  breakInput.addEventListener('input', () => {
    breakMinutes = Number(breakInput.value) || 1;
    updateSummary();
  });
  startButton.addEventListener('click', toggleTimer);
  skipButton.addEventListener('click', advancePhase);
  resetButton.addEventListener('click', reset);
  soundButton.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('ro-sound', soundOn ? 'on' : 'off');
    soundButton.setAttribute('aria-pressed', String(soundOn));
    soundLabel.textContent = soundOn ? 'Lyd på' : 'Lyd av';
  });

  soundButton.setAttribute('aria-pressed', String(soundOn));
  soundLabel.textContent = soundOn ? 'Lyd på' : 'Lyd av';
  renderPlanner();
}

if (typeof document !== 'undefined') init();
