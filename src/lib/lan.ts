/** Helpers for the local network tools: what a device probably is, MAC tidying, CSV export. */
import { SERVICES } from './ports';

export interface DeviceFacts {
  readonly ip: string;
  readonly open: readonly number[];
  readonly vendor?: string | null;
  readonly name?: string | null;
}

/** Ports that suggest what a device is, most telling first. */
const SIGNS: readonly (readonly [readonly number[], string])[] = [
  [[9100, 631, 515], 'Printer'],
  [[554], 'Camera or video recorder'],
  [[8009], 'Chromecast or smart TV'],
  [[62078], 'iPhone or iPad'],
  [[7000], 'Apple TV, Mac or AirPlay speaker'],
  [[3389], 'Windows computer'],
  [[5000, 5001], 'NAS or media server'],
  [[1883, 8883], 'Smart-home hub (MQTT)'],
  [[502, 44818, 47808, 4840], 'Industrial controller'],
];

const MAKERS: readonly (readonly [RegExp, string])[] = [
  [/espressif/i, 'ESP8266 or ESP32 board'],
  [/raspberry pi/i, 'Raspberry Pi'],
  [/arduino/i, 'Arduino board'],
  [/hikvision|dahua|axis comm|uniview/i, 'Camera or video recorder'],
  [/canon|epson|brother|hewlett|kyocera|ricoh|xerox|lexmark/i, 'Printer (by maker)'],
  [/synology|qnap|western digital/i, 'NAS'],
  [/sonos/i, 'Speaker'],
  [/tp-link|netgear|d-link|ubiquiti|mikrotik|tenda|huawei|zte|cisco|juniper|aruba/i, 'Network equipment'],
  [/apple/i, 'Apple device'],
  [/samsung|xiaomi|oneplus|oppo|vivo|realme|motorola|google/i, 'Phone, tablet or TV'],
  [/intel|realtek|dell|lenovo|asustek|micro-star|gigabyte|hon hai|liteon|azurewave/i, 'Computer'],
];

/** A best guess at the kind of device, from its open ports, maker and name. */
export function guessDevice(d: DeviceFacts): string | null {
  const open = new Set(d.open);
  for (const [ports, label] of SIGNS) if (ports.some((p) => open.has(p))) return label;
  if (open.has(53) && (open.has(80) || open.has(443))) return 'Router';
  if (open.has(445) && open.has(139)) return 'Windows computer or file server';
  const name = d.name ?? '';
  if (/router|gateway|fritz|openwrt|tplink/i.test(name)) return 'Router';
  if (/iphone|ipad/i.test(name)) return 'iPhone or iPad';
  if (/android|galaxy|pixel/i.test(name)) return 'Android device';
  if (/printer|epson|brother|canon|hp[a-f0-9]{6}/i.test(name)) return 'Printer';
  if (/esp[-_]?\w*|tasmota|shelly/i.test(name)) return 'ESP8266 or ESP32 board';
  if (d.vendor) for (const [pattern, label] of MAKERS) if (pattern.test(d.vendor)) return label;
  if (open.has(22)) return 'Linux computer or server';
  if (open.has(80) || open.has(443)) return 'Device with a web page';
  return null;
}

/** "3c-52-82-1a-2b-3c" or "3C52821A2B3C" → "3C:52:82:1A:2B:3C", or null when it is not a MAC address. */
export function normaliseMac(text: string): string | null {
  const hex = text.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12 || /[^0-9a-f:.\-\s]/i.test(text.trim())) return null;
  return (hex.toUpperCase().match(/../g) ?? []).join(':');
}

export const serviceName = (port: number): string => SERVICES[port] ?? `Port ${port}`;

/** Ports whose page can be opened in a browser. */
export function webAddress(ip: string, open: readonly number[]): string | null {
  if (open.includes(443)) return `https://${ip}/`;
  if (open.includes(80)) return `http://${ip}/`;
  for (const port of [8080, 8000, 8008, 5000, 8443, 5001]) if (open.includes(port)) return `${port === 8443 || port === 5001 ? 'https' : 'http'}://${ip}:${port}/`;
  return null;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export interface DeviceRow extends DeviceFacts {
  readonly mac: string | null;
  readonly rtt: number | null;
}

export function devicesCsv(rows: readonly DeviceRow[]): string {
  const lines = [['IP address', 'Name', 'MAC address', 'Maker', 'Probably', 'Open ports', 'Response (ms)'].join(',')];
  for (const r of rows) {
    lines.push(
      [r.ip, r.name ?? '', r.mac ?? '', r.vendor ?? '', guessDevice(r) ?? '', r.open.map((p) => `${p} ${serviceName(p)}`).join('; '), r.rtt === null ? '' : String(r.rtt)].map(csvCell).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** 123.4 → "123 Mbit/s"; 1234 → "1.23 Gbit/s". */
export function formatRate(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return '–';
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbit/s`;
  return `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mbit/s`;
}

/** What a measured rate means for everyday use. */
export function rateMeaning(mbps: number): string {
  if (mbps >= 700) return 'Gigabit cable speed.';
  if (mbps >= 250) return 'Fast: good Wi-Fi 5/6 or 1 Gbit/s cable with something slowing it.';
  if (mbps >= 80) return 'Fine for 4K video and large file copies.';
  if (mbps >= 25) return 'Enough for HD video; big copies will take a while.';
  if (mbps >= 5) return 'Slow: weak Wi-Fi signal, an old router or a busy network.';
  return 'Very slow: check the signal, cables and what else is using the network.';
}
