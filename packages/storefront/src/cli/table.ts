export type Status = 'PASS' | 'FAIL' | 'WARN' | 'INFO' | 'SKIP';
export interface Row {
  status: Status;
  check: string;
  detail: string;
}

const color = (s: Status) => {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return s;
  const c = { PASS: 32, FAIL: 31, WARN: 33, INFO: 36, SKIP: 90 }[s];
  return `\u001b[${c}m${s}\u001b[0m`;
};

export function printTable(rows: Row[]) {
  const w1 = Math.max(5, ...rows.map((r) => r.check.length));
  const line = `+--------+${'-'.repeat(w1 + 2)}+${'-'.repeat(62)}`;
  console.log(line);
  console.log(`| Status | ${'Check'.padEnd(w1)} | Detail`);
  console.log(line);
  for (const r of rows) {
    const details = r.detail.split('\n');
    console.log(`| ${color(r.status)}${' '.repeat(6 - r.status.length)} | ${r.check.padEnd(w1)} | ${details[0]}`);
    for (const d of details.slice(1)) console.log(`|        | ${''.padEnd(w1)} |   ${d}`);
  }
  console.log(line);
}

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MiB` : `${(n / 1024).toFixed(1)} KB`);
