// Playtest kit — the host's side of the table. Composes the invite with
// today's Daily and this week's Major, and turns the observation form into
// a pre-filled GitHub issue. Zero dependencies, zero game state touched.

import { dailyNumber } from '../engine/puzzle.js';
import { weekKey } from '../engine/gauntlet.js';

const SITE = 'https://jamessvolos.github.io/GolfCMS/';
const REPO_ISSUES = 'https://github.com/jamessvolos/GolfCMS/issues/new';

// ---- invite ----
const inviteText =
  `You're invited to a Caddie playtest 🎯\n` +
  `It's a golf decision game — you pick the target, your dispersion picks the shot.\n\n` +
  `Today's Daily (#${dailyNumber()}): ${SITE}\n` +
  `This week's Major (${weekKey()}): ${SITE}#/major\n\n` +
  `Nothing to install — it runs in the browser, phone or laptop.\n` +
  `Play it your way; I'll just watch and take notes.`;

const inviteEl = document.getElementById('invite-text');
inviteEl.value = inviteText;

function flash(el, msg) {
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 1600);
}

async function copyText(text, flashEl) {
  try {
    await navigator.clipboard.writeText(text);
    flash(flashEl, 'Copied ✓');
  } catch {
    flash(flashEl, 'Select + copy manually');
  }
}

document.getElementById('copy-invite').addEventListener('click', () =>
  copyText(inviteEl.value, document.getElementById('copied')));

// ---- watch-script → task tally ----
const TASKS = ['t1', 't2', 't3', 't4', 't5'];
function taskTally() {
  const n = TASKS.filter((id) => document.getElementById(id).checked).length;
  return `${n} / ${TASKS.length}`;
}

// ---- feedback form → GitHub issue ----
const val = (id) => document.getElementById(id).value.trim();

function composeIssue() {
  const player = val('f-player') || 'anonymous';
  const title = `Playtest: ${player} · ${val('f-device')} · Daily #${dailyNumber()}`;
  const body = [
    `## Playtest report`,
    ``,
    `- **Player:** ${player}`,
    `- **Device:** ${val('f-device')}`,
    `- **Session:** Daily #${dailyNumber()} / Major ${weekKey()}`,
    `- **Watch-script tasks passed:** ${taskTally()}`,
    `- **Would play tomorrow:** ${val('f-return')}`,
    ``,
    `### What confused them`,
    val('f-confusion') || '_(nothing noted)_',
    ``,
    `### Best quote`,
    val('f-quote') ? `> ${val('f-quote')}` : '_(none captured)_',
    ``,
    `### Notes`,
    val('f-notes') || '_(none)_',
  ].join('\n');
  return { title, body };
}

function refreshIssueLink() {
  document.getElementById('f-tasks').value = taskTally();
  const { title, body } = composeIssue();
  document.getElementById('issue-link').href =
    `${REPO_ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

for (const id of ['f-player', 'f-device', 'f-confusion', 'f-quote', 'f-return', 'f-notes', ...TASKS]) {
  document.getElementById(id).addEventListener('input', refreshIssueLink);
  document.getElementById(id).addEventListener('change', refreshIssueLink);
}
refreshIssueLink();

document.getElementById('copy-issue').addEventListener('click', () => {
  const { title, body } = composeIssue();
  copyText(`${title}\n\n${body}`, document.getElementById('issue-copied'));
});
