import { isRecord } from './api.ts';

export type Out = { write: (s: string) => unknown };
export type Io = { stdout: Out; stderr: Out };
export type Row = Record<string, unknown>;

// Task text is user data: control characters (including ESC) must not reach the terminal.
export function clean(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ');
}

export function oneLine(s: string): string {
  return clean(s).replace(/\s+/g, ' ').trim();
}

export function printJson(io: Io, data: unknown): void {
  io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function str(o: Row, key: string): string {
  const v = o[key];
  return typeof v === 'string' ? v : '';
}

export function id8(o: Row): string {
  return str(o, 'id').slice(0, 8);
}

export function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows].map((r) => r.map(oneLine));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  return (
    all
      .map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] ?? 0))).join('  ').trimEnd())
      .join('\n') + '\n'
  );
}

export function printTasks(io: Io, tasks: Row[]): void {
  if (tasks.length === 0) {
    io.stdout.write('no tasks\n');
    return;
  }
  const rows = tasks.map((t) => [
    id8(t),
    str(t, 'status'),
    str(t, 'dueDate').slice(0, 10),
    `${t.isFocusedToday === true ? '* ' : ''}${oneLine(str(t, 'title'))}`,
  ]);
  io.stdout.write(table(['ID', 'STATUS', 'DUE', 'TITLE'], rows));
}

export function printTaskBlock(io: Io, t: Row): void {
  const list = (k: string): string => (Array.isArray(t[k]) ? t[k].filter((x) => typeof x === 'string').join(', ') : '');
  const fields: [string, string][] = [
    ['title', oneLine(str(t, 'title'))],
    ['id', str(t, 'id')],
    ['status', str(t, 'status')],
    ['area', str(t, 'areaId')],
    ['project', str(t, 'projectId')],
    ['section', str(t, 'sectionId')],
    ['due', str(t, 'dueDate')],
    ['start', str(t, 'startTime')],
    ['review', str(t, 'reviewAt')],
    ['priority', str(t, 'priority')],
    ['tags', list('tags')],
    ['contexts', list('contexts')],
    ['focus', t.isFocusedToday === true ? 'yes' : 'no'],
  ];
  const shown = fields.map(([k, v]): [string, string] => [k, oneLine(v)]).filter(([, v]) => v !== '');
  const w = Math.max(...shown.map(([k]) => k.length)) + 1;
  let out = shown.map(([k, v]) => `${`${k}:`.padEnd(w)} ${v}`).join('\n') + '\n';
  const desc = str(t, 'description');
  if (desc !== '') out += `description:\n${clean(desc)}\n`;
  io.stdout.write(out);
}

// Areas, projects and sections do not share one name field (`name` vs `title`).
export function nameOf(o: Row): string {
  return oneLine(str(o, 'name') || str(o, 'title'));
}

export function printNamed(io: Io, items: Row[], opts: { status?: boolean; empty: string }): void {
  if (items.length === 0) {
    io.stdout.write(`${opts.empty}\n`);
    return;
  }
  const headers = opts.status ? ['ID', 'NAME', 'STATUS'] : ['ID', 'NAME'];
  const rows = items.map((o) => (opts.status ? [id8(o), nameOf(o), str(o, 'status')] : [id8(o), nameOf(o)]));
  io.stdout.write(table(headers, rows));
}

export function printMutation(io: Io, verb: string, o: Row | undefined, fallbackId: string): void {
  const rec = o !== undefined && isRecord(o) ? o : {};
  const id = str(rec, 'id') || fallbackId;
  const title = oneLine(str(rec, 'title'));
  io.stdout.write(`${verb} ${oneLine(id.slice(0, 8))}${title === '' ? '' : ` ${title}`}\n`);
}
