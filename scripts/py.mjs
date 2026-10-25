#!/usr/bin/env node
// Cross-platform runner for the repo's Python virtualenv (.venv), used by the npm scripts.
//
//   node scripts/py.mjs setup                       create .venv and install backend[dev] + mock-bank
//   node scripts/py.mjs [--cwd <dir>] <python args> run the venv's python, e.g. `-m pytest`
//
// Windows uses .venv/Scripts/python.exe, everything else .venv/bin/python. --cwd is relative to the
// repo root. The exit code of python is passed through.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const VENV = path.join(ROOT, '.venv');
const VENV_PYTHON = WIN ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python');
const MIN = [3, 12];

function run(cmd, args, cwd = ROOT) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.error) {
    console.error(`py.mjs: could not start ${cmd}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

/** Version of a candidate interpreter as [major, minor], or null when it is not available. */
function versionOf([cmd, ...args]) {
  const res = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0], sys.version_info[1])'], {
    encoding: 'utf8',
  });
  if (res.error || res.status !== 0) return null;
  const [major, minor] = res.stdout.trim().split(/\s+/).map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) ? [major, minor] : null;
}

const atLeastMin = ([major, minor]) => major > MIN[0] || (major === MIN[0] && minor >= MIN[1]);

function setup() {
  const candidates = WIN
    ? [['py', '-3.12'], ['py', '-3'], ['python']]
    : [['python3.12'], ['python3'], ['python']];
  let base = null;
  const seen = [];
  for (const cand of candidates) {
    const v = versionOf(cand);
    if (v) seen.push(`${cand.join(' ')} → ${v.join('.')}`);
    if (v && atLeastMin(v)) {
      base = cand;
      break;
    }
  }
  if (!base) {
    console.error(
      [
        `py.mjs: no Python ${MIN.join('.')}+ found (tried: ${candidates.map((c) => c.join(' ')).join(', ')}).`,
        seen.length ? `Found only: ${seen.join('; ')}.` : 'None of them could be started.',
        WIN
          ? 'Install Python 3.12 from https://www.python.org/downloads/ (tick "py launcher"), or `winget install Python.Python.3.12`, then re-run `npm run setup:py`.'
          : 'Install Python 3.12 (e.g. `apt install python3.12 python3.12-venv` or `brew install python@3.12`), then re-run `npm run setup:py`.',
      ].join('\n'),
    );
    return 1;
  }
  console.log(`py.mjs: creating .venv with \`${base.join(' ')}\``);
  if (!existsSync(VENV_PYTHON)) {
    const status = run(base[0], [...base.slice(1), '-m', 'venv', VENV]);
    if (status !== 0) return status;
  }
  const pip = (...args) => run(VENV_PYTHON, ['-m', 'pip', ...args]);
  return pip('install', '--upgrade', 'pip') || pip('install', '-e', 'backend[dev]', '-e', 'mock-bank');
}

function main(argv) {
  if (argv[0] === 'setup') return setup();
  let cwd = ROOT;
  if (argv[0] === '--cwd') {
    cwd = path.resolve(ROOT, argv[1] ?? '.');
    argv = argv.slice(2);
  }
  if (!existsSync(VENV_PYTHON)) {
    console.error(`py.mjs: ${path.relative(ROOT, VENV_PYTHON)} not found. Run \`npm run setup:py\` first.`);
    return 1;
  }
  return run(VENV_PYTHON, argv, cwd);
}

process.exit(main(process.argv.slice(2)));
