/** Who made a network card, from the first half of its MAC address (IEEE registries). */

interface Table {
  readonly names: readonly string[];
  readonly records: Readonly<Record<'6' | '7' | '9', string>>;
}

let loading: Promise<Table> | null = null;

export function setOuiTable(table: Table): void {
  loading = Promise.resolve(table);
}

function load(): Promise<Table> {
  loading ??= fetch(new URL('oui.json', document.baseURI))
    .then((r) => {
      if (!r.ok) throw new Error('The maker list could not be loaded.');
      return r.json() as Promise<Table>;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

function find(records: string, width: number, prefix: string): number | null {
  const size = width + 3;
  let lo = 0;
  let hi = records.length / size - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const key = records.slice(mid * size, mid * size + width);
    if (key === prefix) return Number.parseInt(records.slice(mid * size + width, mid * size + size), 36);
    if (key < prefix) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** The maker's name for a MAC address, or null when it is unknown or locally assigned (random). */
export async function vendorOf(mac: string): Promise<string | null> {
  const hex = mac.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length < 6) return null;
  // The "locally administered" bit marks random addresses (phones' private Wi-Fi addresses).
  if (Number.parseInt(hex.slice(0, 2), 16) & 2) return null;
  const table = await load();
  for (const width of [9, 7, 6] as const) {
    const index = find(table.records[String(width) as '6' | '7' | '9'], width, hex.slice(0, width));
    if (index !== null) return table.names[index] ?? null;
  }
  return null;
}

export const isRandomMac = (mac: string): boolean => {
  const first = Number.parseInt(mac.replace(/[^0-9a-f]/gi, '').slice(0, 2), 16);
  return Number.isFinite(first) && (first & 2) === 2;
};
