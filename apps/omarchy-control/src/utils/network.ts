import type { NodeEntry, PortSuggestion } from "../types";

/**
 * Checks if two IPv4 addresses are in the same local subnet (/24 for 192.168.x.x, /16 for 10.x / 172.x)
 */
export function areIpsInSameSubnet(ipA: string, ipB: string): boolean {
  const cleanA = ipA.trim();
  const cleanB = ipB.trim();
  if (cleanA === cleanB) return true;

  const partsA = cleanA.split(".").map((p) => parseInt(p, 10));
  const partsB = cleanB.split(".").map((p) => parseInt(p, 10));

  if (partsA.length !== 4 || partsB.length !== 4 || partsA.some(isNaN) || partsB.some(isNaN)) {
    return false;
  }

  // 192.168.x.y -> check /24 (first 3 octets)
  if (partsA[0] === 192 && partsA[1] === 168 && partsB[0] === 192 && partsB[1] === 168) {
    return partsA[2] === partsB[2];
  }

  // 10.x.y.z -> check /16
  if (partsA[0] === 10 && partsB[0] === 10) {
    return partsA[1] === partsB[1];
  }

  // 172.16-31.x.y -> check /16
  if (partsA[0] === 172 && partsB[0] === 172 && partsA[1] >= 16 && partsA[1] <= 31 && partsB[1] >= 16 && partsB[1] <= 31) {
    return partsA[1] === partsB[1];
  }

  return false;
}

/**
 * Normalizes a DDNS domain or subdomain (e.g. 'cloudgamingadrian' -> 'cloudgamingadrian.duckdns.org')
 */
export function normalizeDdnsDomain(raw?: string | null): string {
  if (!raw) return "cloudgamingadrian.duckdns.org";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "cloudgamingadrian.duckdns.org";
  if (!trimmed.includes(".")) {
    return `${trimmed}.duckdns.org`;
  }
  return trimmed;
}

/**
 * Checks if two nodes are on the same local network / router NAT domain
 */
export function areNodesOnSameLan(
  hostA: string,
  ddnsA: string | null | undefined,
  hostB: string,
  ddnsB: string | null | undefined,
): { isSameLan: boolean; reason: string } {
  const cleanHostA = (hostA || "").trim();
  const cleanHostB = (hostB || "").trim();

  if (!cleanHostA || !cleanHostB) {
    return { isSameLan: false, reason: "Host non specificato" };
  }

  // 1. Identical host / IP
  if (cleanHostA.toLowerCase() === cleanHostB.toLowerCase()) {
    return { isSameLan: true, reason: "Stesso indirizzo host/IP" };
  }

  // 2. Controllo domini DuckDNS: se differenti, sono sedi o modem distinti
  const cleanDdnsA = (ddnsA || "").trim().toLowerCase();
  const cleanDdnsB = (ddnsB || "").trim().toLowerCase();
  if (cleanDdnsA && cleanDdnsB) {
    if (cleanDdnsA !== cleanDdnsB) {
      return { isSameLan: false, reason: "Domini DuckDNS differenti (sedi o connessioni distinte)" };
    } else {
      return { isSameLan: true, reason: `Stesso dominio DuckDNS (${cleanDdnsA})` };
    }
  }

  // 3. Subnet matching
  if (areIpsInSameSubnet(cleanHostA, cleanHostB)) {
    return { isSameLan: true, reason: "Stessa sottorete LAN locale (stesso modem/gateway)" };
  }

  // 4. If neither defines a custom DDNS domain, they share the cluster's global WAN IP / DuckDNS
  if (!cleanDdnsA && !cleanDdnsB) {
    if (cleanHostA.startsWith("192.168.") && cleanHostB.startsWith("192.168.")) {
      const partsA = cleanHostA.split(".");
      const partsB = cleanHostB.split(".");
      if (partsA[2] === partsB[2]) {
        return { isSameLan: true, reason: "Stessa rete LAN privata (192.168.x.x)" };
      }
    }
  }

  return { isSameLan: false, reason: "Nodi su reti differenti" };
}

/**
 * Fast client-side calculation of the next available streaming port without LAN conflict
 */
export function computeSuggestedStreamingPort(
  existingNodes: NodeEntry[],
  targetHost: string,
  targetDdns?: string | null,
  excludeNodeId?: string | null,
): PortSuggestion {
  const cleanHost = (targetHost || "").trim();
  if (!cleanHost) {
    return {
      port: 47989,
      is_conflict: false,
      conflicting_node: null,
      reason: "Inserisci l'indirizzo host del server",
    };
  }

  const usedPorts = new Set<number>();
  let conflictingNode: string | null = null;
  let conflictReason = "";

  for (const node of existingNodes) {
    if (excludeNodeId && node.id === excludeNodeId) {
      continue;
    }
    const { isSameLan, reason } = areNodesOnSameLan(
      node.host,
      node.ddns_domain,
      cleanHost,
      targetDdns,
    );
    if (isSameLan) {
      usedPorts.add(node.streaming_port || 47989);
      if (!conflictingNode || (node.streaming_port || 47989) === 47989) {
        conflictingNode = `${node.name || "Nodo"} (${node.host})`;
        conflictReason = reason;
      }
    }
  }

  let candidate = 47989;
  let hasConflict = false;
  while (usedPorts.has(candidate)) {
    hasConflict = true;
    candidate += 1000;
  }

  if (hasConflict) {
    return {
      port: candidate,
      is_conflict: true,
      conflicting_node: conflictingNode,
      reason: `Rilevato nodo sulla stessa LAN (${conflictReason}). Assegnata automaticamente la porta libera ${candidate}.`,
    };
  }

  return {
    port: 47989,
    is_conflict: false,
    conflicting_node: null,
    reason: "Nessun conflitto rilevato sulla rete locale. Porta standard 47989 disponibile.",
  };
}
