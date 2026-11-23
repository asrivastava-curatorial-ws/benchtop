/** Port numbers: what usually listens on them, and "22, 80-90, 443" lists. */
import { ToolError } from './errors';

export const SERVICES: Record<number, string> = {
  20: 'FTP data',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  88: 'Kerberos',
  110: 'POP3',
  111: 'RPC',
  123: 'NTP',
  135: 'MS RPC',
  139: 'NetBIOS',
  143: 'IMAP',
  161: 'SNMP',
  389: 'LDAP',
  443: 'HTTPS',
  445: 'SMB',
  465: 'SMTPS',
  502: 'Modbus',
  515: 'LPD printing',
  514: 'Syslog',
  548: 'Apple file sharing',
  554: 'RTSP video stream',
  587: 'SMTP submission',
  631: 'IPP printing',
  636: 'LDAPS',
  853: 'DNS over TLS',
  873: 'rsync',
  993: 'IMAPS',
  995: 'POP3S',
  1080: 'SOCKS',
  1194: 'OpenVPN',
  1433: 'SQL Server',
  1521: 'Oracle',
  1723: 'PPTP',
  1883: 'MQTT',
  1900: 'UPnP',
  2049: 'NFS',
  2375: 'Docker (no TLS)',
  2376: 'Docker',
  3000: 'Dev server',
  3306: 'MySQL',
  3389: 'Remote Desktop',
  4840: 'OPC UA',
  5000: 'Dev server / NAS',
  5001: 'NAS (HTTPS)',
  5060: 'SIP',
  5173: 'Vite',
  5353: 'mDNS',
  5432: 'PostgreSQL',
  5672: 'AMQP',
  5900: 'VNC',
  6379: 'Redis',
  6443: 'Kubernetes API',
  7000: 'AirPlay',
  8000: 'HTTP alt',
  8008: 'HTTP alt / Chromecast',
  8009: 'Chromecast',
  8080: 'HTTP proxy / alt',
  8443: 'HTTPS alt',
  8883: 'MQTT over TLS',
  9000: 'App server',
  9090: 'Prometheus',
  9092: 'Kafka',
  9100: 'Printer (raw)',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  25565: 'Minecraft',
  27017: 'MongoDB',
  44818: 'EtherNet/IP',
  47808: 'BACnet',
  62078: 'iPhone and iPad sync',
};

/** "22, 80-90, 443" → ports. */
export function parsePorts(text: string, limit = 1024): number[] {
  const ports = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    if (part === '') continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const low = Number(range[1]);
      const high = Number(range[2]);
      if (low < 1 || high > 65535 || low > high) throw new ToolError(`"${part}" is not a valid port range.`);
      for (let port = low; port <= high; port++) {
        ports.add(port);
        if (ports.size > limit) throw new ToolError(`Check at most ${limit} ports at a time.`);
      }
      continue;
    }
    const port = Number(part);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ToolError(`"${part}" is not a port number (1–65535).`);
    ports.add(port);
  }
  if (ports.size === 0) throw new ToolError('Enter at least one port.');
  if (ports.size > limit) throw new ToolError(`Check at most ${limit} ports at a time.`);
  return [...ports];
}
