/**
 * Verifies that a domain controls the given owner key by checking DNS TXT records.
 * Uses DNS-over-HTTPS (DoH) to work in Cloudflare Workers, Node.js, and Bun.
 */
export async function verifyDomainControl(domain: string, assertedOwnerKey: string): Promise<boolean> {
  try {
    const txtRecords = await fetchTxtRecords(domain);
    if (txtRecords.length === 0) {
      console.warn(`No DNS TXT records found for entity under domain: ${domain}`);
      return false;
    }

    const matchingRecord = txtRecords.find(
      (record) => record.startsWith("v=intel-gateway1")
    );

    if (!matchingRecord) {
      console.warn(`No valid intelligence gateway TXT record found under domain: ${domain}`);
      return false;
    }

    // Parse attributes: e.g., v=intel-gateway1; k=ed25519; p=OWNER_KEY_HERE
    // Convert semicolon delimited format to a standard query-string layout for easy parsing
    const normalizedQuery = matchingRecord.replace(/;\s*/g, "&");
    const params = new URLSearchParams(normalizedQuery);
    const registeredKey = params.get("p") ?? params.get("owner");

    if (!registeredKey) {
      console.warn(`TXT record found but missing owner key parameter under domain: ${domain}`);
      return false;
    }

    return registeredKey === assertedOwnerKey;
  } catch (error) {
    console.error(`DNS Resolution failure on domain: ${domain}`, error);
    return false;
  }
}

/**
 * Fetches DNS TXT records from the generalized control subdomain.
 * using Cloudflare's secure DNS-over-HTTPS API.
 */
async function fetchTxtRecords(domain: string): Promise<string[]> {
  const targets = [`_intel.${domain}`];
  const records: string[] = [];

  for (const target of targets) {
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(target)}&type=TXT`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/dns-json",
        },
      });

      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as {
        Answer?: Array<{ type: number; data: string }>;
      };

      if (data.Answer && Array.isArray(data.Answer)) {
        for (const ans of data.Answer) {
          // TXT record type in DNS is 16
          if (ans.type === 16 && ans.data) {
            // DoH data fields often wrap the string in double quotes. Clean them up.
            const cleaned = ans.data.replace(/^"|"$/g, "");
            records.push(cleaned);
          }
        }
      }
    } catch (err) {
      console.error(`DoH lookup error for ${target}:`, err);
    }
  }

  return records;
}
